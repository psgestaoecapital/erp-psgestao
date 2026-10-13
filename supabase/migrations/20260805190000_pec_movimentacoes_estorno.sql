-- RD-41 · Agro/Pecuária (Estância Umuarama · Ivan) — gestão de Movimentações do Rebanho.
-- Hoje a baixa de venda/transferência acontece mas não há como consultar/corrigir/reverter. Se algo
-- foi lançado por engano (venda errada), o animal precisa voltar ao estágio anterior — com segurança.
--
-- Fundação (RD-26): reusa erp_pec_movimentacao (1 linha por animal) + erp_pec_animal + erp_receber
-- (ref_externa_id liga a venda à receita). O `fn_pec_animal_vender` cria N linhas por venda mas NÃO
-- havia chave que agrupasse as N linhas de uma mesma venda — este migration adiciona `grupo_id`.
-- Como now() é constante na transação, TODAS as linhas de uma chamada compartilham created_at → é a
-- chave confiável pro backfill (chamadas distintas = created_at distinto).
--
-- Guardas: RD-55 (estorno/exclusão nunca apaga físico; confirmação + motivo + rastro; snapshot do
-- estado); RD-51 (valor/qtd reais, corrige o arredondamento que fazia soma≠receita); Fronteira GE (o
-- cancelamento da receita é disparado aqui, não recriado); Pilar 2 (multi-tenant em tudo).

-- ── 1. COLUNAS: agrupamento + rastro de estorno/exclusão + snapshot (RD-55) ──────────────────────
ALTER TABLE public.erp_pec_movimentacao
  ADD COLUMN IF NOT EXISTS grupo_id       uuid,
  ADD COLUMN IF NOT EXISTS estornada      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estornada_em   timestamptz,
  ADD COLUMN IF NOT EXISTS estornada_por  uuid,
  ADD COLUMN IF NOT EXISTS motivo_estorno text,
  ADD COLUMN IF NOT EXISTS deleted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_por    uuid,
  ADD COLUMN IF NOT EXISTS snapshot_animal jsonb;   -- estado do animal ANTES da baixa (RD-55)

-- backfill: 1 grupo por (empresa, propriedade, tipo, contraparte, data, created_at). created_at é o
-- instante da transação que criou as N linhas da venda/transferência → agrupa exatamente 1 chamada.
UPDATE public.erp_pec_movimentacao m
   SET grupo_id = g.novo
  FROM (
    SELECT company_id, propriedade_id, tipo, coalesce(contraparte_nome,'') AS cp, data, created_at,
           gen_random_uuid() AS novo
    FROM public.erp_pec_movimentacao
    WHERE grupo_id IS NULL
    GROUP BY company_id, propriedade_id, tipo, coalesce(contraparte_nome,''), data, created_at
  ) g
 WHERE m.grupo_id IS NULL
   AND m.company_id = g.company_id AND m.propriedade_id = g.propriedade_id
   AND m.tipo = g.tipo AND coalesce(m.contraparte_nome,'') = g.cp AND m.data = g.data
   AND m.created_at = g.created_at;

CREATE INDEX IF NOT EXISTS idx_pec_mov_grupo ON public.erp_pec_movimentacao (grupo_id);
CREATE INDEX IF NOT EXISTS idx_pec_mov_empresa_data ON public.erp_pec_movimentacao (company_id, data DESC);

-- tipo passa a aceitar 'estorno' (evento reverso auditável criado pelo fn_..._estornar).
ALTER TABLE public.erp_pec_movimentacao DROP CONSTRAINT IF EXISTS erp_pec_movimentacao_tipo_check;
ALTER TABLE public.erp_pec_movimentacao ADD CONSTRAINT erp_pec_movimentacao_tipo_check
  CHECK (tipo = ANY (ARRAY['nascimento','compra','desmama','retencao','transferencia','pesagem',
    'entrada_confinamento','venda','morte','abate','ajuste','estorno']));

-- ── 2. HELPER (RD-55): reverte os animais de um grupo ao estágio anterior. Usado por estornar/excluir.
CREATE OR REPLACE FUNCTION public.fn_pec_mov_reverter_animais(p_company_id uuid, p_grupo_id uuid)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tipo text; v_row record; v_n int := 0; v_snap jsonb;
BEGIN
  SELECT tipo INTO v_tipo FROM erp_pec_movimentacao
   WHERE COALESCE(grupo_id, id) = p_grupo_id AND company_id = p_company_id AND deleted_at IS NULL LIMIT 1;

  FOR v_row IN
    SELECT * FROM erp_pec_movimentacao
     WHERE COALESCE(grupo_id, id) = p_grupo_id AND company_id = p_company_id
       AND animal_id IS NOT NULL AND deleted_at IS NULL
  LOOP
    v_snap := v_row.snapshot_animal;
    IF v_tipo LIKE 'transfer%' THEN
      UPDATE erp_pec_animal SET
        lote_id       = COALESCE(nullif(v_snap->>'lote_id','')::uuid, v_row.lote_id, lote_id),
        area_atual_id = COALESCE(nullif(v_snap->>'area_atual_id','')::uuid, v_row.area_origem_id, area_atual_id),
        updated_at = now()
      WHERE id = v_row.animal_id AND company_id = p_company_id;
    ELSE
      -- venda/morte/saída → reativa. Restaura status do snapshot; senão 'ativo' (default seguro).
      UPDATE erp_pec_animal SET
        status           = COALESCE(nullif(v_snap->>'status',''), 'ativo'),
        ativo            = COALESCE((v_snap->>'ativo')::boolean, true),
        data_saida       = nullif(v_snap->>'data_saida','')::date,   -- normalmente NULL (volta ao rebanho)
        motivo_saida     = nullif(v_snap->>'motivo_saida',''),
        contraparte_nome = nullif(v_snap->>'contraparte_nome',''),
        lote_id          = COALESCE(nullif(v_snap->>'lote_id','')::uuid, lote_id),
        updated_at = now()
      WHERE id = v_row.animal_id AND company_id = p_company_id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

-- ── 3. LISTA (FIX 1) — 1 linha por grupo, filtrável, multi-tenant, ordem data desc ──────────────
CREATE OR REPLACE FUNCTION public.fn_pec_movimentacoes_listar(
  p_company_id uuid, p_propriedade_id uuid DEFAULT NULL, p_tipo text DEFAULT NULL,
  p_de date DEFAULT NULL, p_ate date DEFAULT NULL, p_lote_id uuid DEFAULT NULL,
  p_animal_id uuid DEFAULT NULL, p_incluir_estornadas boolean DEFAULT true, p_limit int DEFAULT 300)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  WITH g AS (
    SELECT COALESCE(m.grupo_id, m.id) AS gkey,
           max(m.tipo) AS tipo, max(m.data) AS data, min(m.created_at) AS created_at,
           count(*) FILTER (WHERE m.animal_id IS NOT NULL) AS qtd,
           max(m.contraparte_nome) AS contraparte_nome,
           COALESCE(sum(m.valor), 0) AS valor,
           bool_or(m.estornada) AS estornada,
           max(lo.codigo) AS lote_origem, max(ld.codigo) AS lote_destino,
           max(ao.nome) AS area_origem, max(ad.nome) AS area_destino,
           array_agg(m.id::text) AS mov_ids
    FROM erp_pec_movimentacao m
    LEFT JOIN erp_pec_lote lo ON lo.id = m.lote_id
    LEFT JOIN erp_pec_lote ld ON ld.id = m.lote_destino_id
    LEFT JOIN erp_pec_area ao ON ao.id = m.area_origem_id
    LEFT JOIN erp_pec_area ad ON ad.id = m.area_destino_id
    WHERE m.company_id = p_company_id
      AND m.deleted_at IS NULL
      AND (p_propriedade_id IS NULL OR m.propriedade_id = p_propriedade_id)
      AND (p_tipo IS NULL OR m.tipo = p_tipo)
      AND (p_de IS NULL OR m.data >= p_de)
      AND (p_ate IS NULL OR m.data <= p_ate)
      AND (p_lote_id IS NULL OR m.lote_id = p_lote_id OR m.lote_destino_id = p_lote_id)
      AND (p_animal_id IS NULL OR m.animal_id = p_animal_id)
      AND (p_incluir_estornadas OR m.estornada = false)
    GROUP BY COALESCE(m.grupo_id, m.id)
    ORDER BY max(m.data) DESC, min(m.created_at) DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,300), 1000))
  ), gf AS (
    SELECT g.*, r.id AS receber_id, r.status AS fin_status
    FROM g
    LEFT JOIN LATERAL (
      SELECT r.id, r.status FROM erp_receber r
      WHERE r.company_id = p_company_id AND r.ref_externa_sistema = 'pecuaria'
        AND r.ref_externa_id = ANY (g.mov_ids || ARRAY[g.gkey::text])
      ORDER BY r.created_at DESC LIMIT 1
    ) r ON true
  )
  SELECT jsonb_build_object('ok', true, 'movimentacoes', COALESCE(jsonb_agg(jsonb_build_object(
    'grupo_id', gkey, 'tipo', tipo, 'data', data, 'created_at', created_at, 'qtd', qtd,
    'contraparte_nome', contraparte_nome, 'valor', valor,
    'lote_origem', lote_origem, 'lote_destino', lote_destino,
    'area_origem', area_origem, 'area_destino', area_destino,
    'estornada', estornada, 'tem_financeiro', receber_id IS NOT NULL, 'financeiro_status', fin_status
  ) ORDER BY data DESC, created_at DESC), '[]'::jsonb)) INTO v_out
  FROM gf;

  RETURN v_out;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_movimentacoes_listar(uuid, uuid, text, date, date, uuid, uuid, boolean, int) TO authenticated;

-- ── 4. DETALHE (FIX 2) — cabeçalho + animais + financeiro vinculado ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pec_movimentacao_obter(p_company_id uuid, p_grupo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_refs text[]; v_head jsonb; v_animais jsonb; v_fin jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  SELECT array_agg(id::text) || ARRAY[p_grupo_id::text] INTO v_refs
  FROM erp_pec_movimentacao
  WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL;
  IF v_refs IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Movimentação não encontrada'); END IF;

  SELECT jsonb_build_object(
    'grupo_id', p_grupo_id, 'tipo', max(m.tipo), 'data', max(m.data),
    'qtd', count(*) FILTER (WHERE m.animal_id IS NOT NULL),
    'contraparte_nome', max(m.contraparte_nome), 'valor', COALESCE(sum(m.valor),0),
    'peso_kg', sum(m.peso_kg), 'observacao', max(m.observacao),
    'lote_origem', max(lo.codigo), 'lote_destino', max(ld.codigo),
    'estornada', bool_or(m.estornada), 'motivo_estorno', max(m.motivo_estorno), 'estornada_em', max(m.estornada_em)
  ) INTO v_head
  FROM erp_pec_movimentacao m
  LEFT JOIN erp_pec_lote lo ON lo.id = m.lote_id
  LEFT JOIN erp_pec_lote ld ON ld.id = m.lote_destino_id
  WHERE m.company_id = p_company_id AND COALESCE(m.grupo_id, m.id) = p_grupo_id AND m.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'animal_id', a.id, 'identificacao', a.identificacao, 'status', a.status, 'ativo', a.ativo,
    'valor', m.valor) ORDER BY a.identificacao), '[]'::jsonb) INTO v_animais
  FROM erp_pec_movimentacao m JOIN erp_pec_animal a ON a.id = m.animal_id
  WHERE m.company_id = p_company_id AND COALESCE(m.grupo_id, m.id) = p_grupo_id AND m.deleted_at IS NULL;

  SELECT jsonb_build_object('receber_id', r.id, 'valor', r.valor, 'status', r.status, 'descricao', r.descricao)
    INTO v_fin
  FROM erp_receber r
  WHERE r.company_id = p_company_id AND r.ref_externa_sistema = 'pecuaria' AND r.ref_externa_id = ANY (v_refs)
  ORDER BY r.created_at DESC LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'movimentacao', v_head, 'animais', v_animais, 'financeiro', v_fin);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_movimentacao_obter(uuid, uuid) TO authenticated;

-- ── 5. EDITAR (FIX 2) — campos corrigíveis + sincroniza a receita se o valor mudou ──────────────
CREATE OR REPLACE FUNCTION public.fn_pec_movimentacao_editar(
  p_company_id uuid, p_grupo_id uuid, p_valor numeric DEFAULT NULL, p_contraparte_nome text DEFAULT NULL,
  p_data date DEFAULT NULL, p_observacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_refs text[]; v_n int; v_por numeric; v_resto numeric; v_i int := 0; v_id uuid; v_receber uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT array_agg(id ORDER BY created_at, id) INTO v_ids FROM erp_pec_movimentacao
   WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL AND estornada = false;
  IF v_ids IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Movimentação inexistente ou já estornada'); END IF;
  v_n := array_length(v_ids, 1);
  SELECT array_agg(u::text) || ARRAY[p_grupo_id::text] INTO v_refs FROM unnest(v_ids) AS u;

  UPDATE erp_pec_movimentacao SET
    contraparte_nome = COALESCE(nullif(btrim(p_contraparte_nome),''), contraparte_nome),
    data = COALESCE(p_data, data),
    observacao = COALESCE(p_observacao, observacao),
    updated_at = now()
  WHERE id = ANY(v_ids);

  -- valor: redistribui por animal com o resto na 1ª linha (soma == total exato · RD-51)
  IF p_valor IS NOT NULL THEN
    v_por := trunc(p_valor / v_n, 2);
    v_resto := round(p_valor - v_por * v_n, 2);
    FOREACH v_id IN ARRAY v_ids LOOP
      v_i := v_i + 1;
      UPDATE erp_pec_movimentacao SET valor = v_por + (CASE WHEN v_i = 1 THEN v_resto ELSE 0 END), updated_at = now()
       WHERE id = v_id;
    END LOOP;
    -- sincroniza a receita vinculada (fronteira GE: atualiza o lançamento existente, não recria)
    UPDATE erp_receber SET valor = p_valor, updated_at = now()
     WHERE company_id = p_company_id AND ref_externa_sistema = 'pecuaria'
       AND ref_externa_id = ANY (v_refs) AND status <> 'pago'
     RETURNING id INTO v_receber;
  END IF;

  RETURN jsonb_build_object('ok', true, 'linhas', v_n, 'receita_atualizada', v_receber IS NOT NULL);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_movimentacao_editar(uuid, uuid, numeric, text, date, text) TO authenticated;

-- ── 6. ESTORNAR (FIX 3 · o pedido central) — reverte e o animal volta (RD-55) 🎯 ────────────────
CREATE OR REPLACE FUNCTION public.fn_pec_movimentacao_estornar(p_company_id uuid, p_grupo_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_refs text[]; v_tipo text; v_valor numeric; v_qtd int; v_prop uuid; v_receber uuid; v_revertidos int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  IF length(btrim(coalesce(p_motivo,''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo do estorno');   -- RD-55: motivo obrigatório
  END IF;

  SELECT array_agg(id), max(tipo), COALESCE(sum(valor),0), count(*) FILTER (WHERE animal_id IS NOT NULL), (array_agg(propriedade_id))[1]
    INTO v_ids, v_tipo, v_valor, v_qtd, v_prop
  FROM erp_pec_movimentacao
  WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL;
  IF v_ids IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Movimentação não encontrada'); END IF;
  IF EXISTS (SELECT 1 FROM erp_pec_movimentacao WHERE id = ANY(v_ids) AND estornada = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta movimentação já foi estornada');
  END IF;
  SELECT array_agg(u::text) || ARRAY[p_grupo_id::text] INTO v_refs FROM unnest(v_ids) AS u;

  -- (a) animais voltam ao estágio anterior (helper) — RD-55.
  v_revertidos := public.fn_pec_mov_reverter_animais(p_company_id, p_grupo_id);

  -- (b) financeiro: cancela a receita vinculada (não deixa receita órfã). Fronteira GE: cancela, não recria.
  UPDATE erp_receber SET status = 'cancelado', updated_at = now()
   WHERE company_id = p_company_id AND ref_externa_sistema = 'pecuaria'
     AND ref_externa_id = ANY (v_refs) AND status <> 'pago'
   RETURNING id INTO v_receber;

  -- (c) rastro (RD-55): NÃO apaga físico — marca estornada (quem/quando/motivo).
  UPDATE erp_pec_movimentacao SET
    estornada = true, estornada_em = now(), estornada_por = auth.uid(), motivo_estorno = btrim(p_motivo), updated_at = now()
  WHERE id = ANY(v_ids);

  -- (d) registro de estorno visível no histórico (evento reverso, auditável).
  INSERT INTO erp_pec_movimentacao (company_id, propriedade_id, grupo_id, tipo, data, quantidade, valor,
    observacao, ref_externa_sistema, ref_externa_id, criado_por)
  VALUES (p_company_id, v_prop, gen_random_uuid(), 'estorno', CURRENT_DATE, v_qtd, -v_valor,
    'Estorno de ' || v_tipo || ': ' || btrim(p_motivo), 'estorno_mov', p_grupo_id::text, auth.uid());

  RETURN jsonb_build_object('ok', true, 'tipo', v_tipo, 'animais_revertidos', v_revertidos,
    'valor_estornado', v_valor, 'receita_cancelada', v_receber IS NOT NULL);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_movimentacao_estornar(uuid, uuid, text) TO authenticated;

-- ── 7. EXCLUIR (FIX 4) — só p/ lançamento recém-criado por engano; senão orienta a Estornar. Soft. ─
CREATE OR REPLACE FUNCTION public.fn_pec_movimentacao_excluir(p_company_id uuid, p_grupo_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[]; v_refs text[]; v_criado timestamptz; v_fin_pago boolean; v_revertidos int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  SELECT array_agg(id), min(created_at) INTO v_ids, v_criado FROM erp_pec_movimentacao
   WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL;
  IF v_ids IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Movimentação não encontrada'); END IF;
  SELECT array_agg(u::text) || ARRAY[p_grupo_id::text] INTO v_refs FROM unnest(v_ids) AS u;

  -- salvaguarda: se já tem efeito consolidado (receita paga) → não exclui, orienta Estornar.
  SELECT EXISTS (SELECT 1 FROM erp_receber r WHERE r.company_id = p_company_id AND r.ref_externa_sistema = 'pecuaria'
    AND r.ref_externa_id = ANY (v_refs) AND r.status = 'pago') INTO v_fin_pago;
  IF v_fin_pago THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta venda já tem recebimento pago — use Estornar (reverte com rastro), não Excluir.');
  END IF;
  IF v_criado < (now() - interval '24 hours') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não é recente — use Estornar para reverter com histórico.');
  END IF;

  -- reverte animais + cancela receita aberta + soft-delete (nunca físico · RD-55).
  v_revertidos := public.fn_pec_mov_reverter_animais(p_company_id, p_grupo_id);
  UPDATE erp_receber SET status = 'cancelado', updated_at = now()
   WHERE company_id = p_company_id AND ref_externa_sistema = 'pecuaria'
     AND ref_externa_id = ANY (v_refs) AND status <> 'pago';
  UPDATE erp_pec_movimentacao SET deleted_at = now(), deleted_por = auth.uid(),
    observacao = COALESCE(observacao,'') || CASE WHEN nullif(btrim(coalesce(p_motivo,'')),'') IS NOT NULL THEN ' [excluído: ' || btrim(p_motivo) || ']' ELSE ' [excluído]' END,
    updated_at = now()
  WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('ok', true, 'animais_revertidos', v_revertidos);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_movimentacao_excluir(uuid, uuid, text) TO authenticated;

-- ── 8. FIX do BUG (RD-51) — fn_pec_animal_vender: grupo_id, snapshot, arredondamento exato, ref=grupo.
-- Correções vs versão anterior: (1) todas as N linhas ganham o MESMO grupo_id (gestão por venda);
-- (2) snapshot do animal ANTES da baixa (RD-55, permite estorno preciso); (3) o resto do arredondamento
-- vai na 1ª linha → sum(valor) == valor_total EXATO (antes divergia 1-2 centavos da receita); (4) a
-- receita passa a referenciar o grupo_id (antes só a 1ª linha). qtd e valor seguem 100% do input (RD-51).
CREATE OR REPLACE FUNCTION public.fn_pec_animal_vender(p_company_id uuid, p_animal_ids uuid[], p_propriedade_id uuid, p_comprador_id uuid DEFAULT NULL::uuid, p_comprador_nome text DEFAULT NULL::text, p_peso_kg numeric DEFAULT NULL::numeric, p_valor_unitario numeric DEFAULT NULL::numeric, p_unidade text DEFAULT 'kg'::text, p_valor_total numeric DEFAULT NULL::numeric, p_vencimento date DEFAULT NULL::date, p_gerar_financeiro boolean DEFAULT true)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_n int; v_total numeric; v_por numeric; v_resto numeric; v_peso_animal numeric;
  v_comprador_nome text; v_mov_ids uuid[] := '{}'; v_mid uuid; v_receber_id uuid;
  v_aid uuid; v_data date := CURRENT_DATE; v_grupo uuid := gen_random_uuid(); v_i int := 0;
  ARROBA_KG constant numeric := 15;  -- 15kg = 1@ (CONFIRMAR convencao Paraguai/peso vivo)
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  v_n := COALESCE(array_length(p_animal_ids,1),0);
  IF v_n = 0 THEN RAISE EXCEPTION 'Nenhum animal informado'; END IF;

  v_comprador_nome := COALESCE(
    (SELECT nome_fantasia FROM erp_clientes WHERE id=p_comprador_id AND company_id=p_company_id),
    NULLIF(trim(p_comprador_nome),'')
  );

  -- valor total: manual (p_valor_total) senao peso x valor_unitario (kg ou @). Sem valor default fixo (RD-51).
  v_total := COALESCE(
    p_valor_total,
    CASE WHEN p_peso_kg IS NOT NULL AND p_valor_unitario IS NOT NULL THEN
      CASE WHEN p_unidade='arroba' THEN (p_peso_kg / ARROBA_KG) * p_valor_unitario
           ELSE p_peso_kg * p_valor_unitario END
    END,
    0
  );
  -- rateio por animal com resto na 1ª linha → soma exata == v_total (RD-51).
  v_por := trunc(v_total / v_n, 2);
  v_resto := round(v_total - v_por * v_n, 2);
  v_peso_animal := CASE WHEN p_peso_kg IS NOT NULL THEN round(p_peso_kg / v_n, 2) ELSE NULL END;

  FOREACH v_aid IN ARRAY p_animal_ids LOOP
    v_i := v_i + 1;
    INSERT INTO erp_pec_movimentacao (company_id, propriedade_id, animal_id, grupo_id, tipo, data, quantidade,
      peso_kg, valor, contraparte_id, contraparte_nome, criado_por, snapshot_animal)
    SELECT p_company_id, p_propriedade_id, v_aid, v_grupo, 'venda', v_data, 1,
      v_peso_animal, v_por + (CASE WHEN v_i = 1 THEN v_resto ELSE 0 END), p_comprador_id, v_comprador_nome, auth.uid(),
      -- snapshot do estado ANTES da baixa (RD-55) — permite estorno preciso depois.
      jsonb_build_object('status', a.status, 'ativo', a.ativo, 'lote_id', a.lote_id,
        'area_atual_id', a.area_atual_id, 'data_saida', a.data_saida, 'motivo_saida', a.motivo_saida,
        'contraparte_nome', a.contraparte_nome)
    FROM erp_pec_animal a WHERE a.id = v_aid AND a.company_id = p_company_id
    RETURNING id INTO v_mid;
    -- animal sem cadastro (defensivo): ainda registra a movimentação sem snapshot.
    IF v_mid IS NULL THEN
      INSERT INTO erp_pec_movimentacao (company_id, propriedade_id, animal_id, grupo_id, tipo, data, quantidade,
        peso_kg, valor, contraparte_id, contraparte_nome, criado_por)
      VALUES (p_company_id, p_propriedade_id, v_aid, v_grupo, 'venda', v_data, 1,
        v_peso_animal, v_por + (CASE WHEN v_i = 1 THEN v_resto ELSE 0 END), p_comprador_id, v_comprador_nome, auth.uid())
      RETURNING id INTO v_mid;
    END IF;
    v_mov_ids := v_mov_ids || v_mid;
    UPDATE erp_pec_animal SET status='vendido', ativo=false, data_saida=v_data, motivo_saida='venda',
      contraparte_nome=v_comprador_nome, updated_at=now()
    WHERE id=v_aid AND company_id=p_company_id;
  END LOOP;

  -- financeiro: nao trava a venda; so lanca se marcado + tem comprador + valor. ref = grupo_id (a venda toda).
  IF p_gerar_financeiro AND v_total > 0 AND (p_comprador_id IS NOT NULL OR v_comprador_nome IS NOT NULL) THEN
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_vencimento, status, ref_externa_sistema, ref_externa_id)
    VALUES (p_company_id, p_comprador_id, v_comprador_nome,
      'Venda de ' || v_n || ' animal(is) - Pecuária', 'Venda de gado', v_total,
      COALESCE(p_vencimento, v_data), 'aberto', 'pecuaria', v_grupo::text)
    RETURNING id INTO v_receber_id;
  END IF;

  RETURN json_build_object('movimentacao_ids', v_mov_ids, 'grupo_id', v_grupo, 'valor_total', v_total,
    'receber_id', v_receber_id, 'qtd', v_n);
END $function$;
