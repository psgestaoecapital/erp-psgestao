-- RD-41 · Agro/Pecuária (Estância Umuarama · Ivan) — ESTORNO PARCIAL (por animal). Depende de #880.
-- Hoje o estorno reverte o lote inteiro. Na prática, às vezes só 1-2 animais foram lançados por engano
-- ou o comprador devolveu parte. Como erp_pec_movimentacao guarda 1 linha por animal (grupo de 7 = 7
-- linhas), o estorno parcial é natural: reverte só as linhas marcadas.
--
-- Guardas: RD-55 (parcial nunca apaga linha; marca estornada; motivo + rastro por animal; previne duplo
-- estorno); RD-51 (rateio real da receita proporcional aos animais estornados; estado misto refletido na
-- lista); Fronteira GE (ajuste da receita proporcional, disparado por evento); Pilar 2 (multi-tenant).

-- Assinaturas mudam (ganham p_animal_ids) → precisa DROP antes do CREATE (não é replace in-place).
DROP FUNCTION IF EXISTS public.fn_pec_movimentacao_estornar(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fn_pec_mov_reverter_animais(uuid, uuid);

-- ── HELPER: reverte animais de um grupo ao estágio anterior; p_animal_ids NULL = todos (retrocompatível).
CREATE OR REPLACE FUNCTION public.fn_pec_mov_reverter_animais(p_company_id uuid, p_grupo_id uuid, p_animal_ids uuid[] DEFAULT NULL)
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
       AND (p_animal_ids IS NULL OR animal_id = ANY(p_animal_ids))
  LOOP
    v_snap := v_row.snapshot_animal;
    IF v_tipo LIKE 'transfer%' THEN
      UPDATE erp_pec_animal SET
        lote_id       = COALESCE(nullif(v_snap->>'lote_id','')::uuid, v_row.lote_id, lote_id),
        area_atual_id = COALESCE(nullif(v_snap->>'area_atual_id','')::uuid, v_row.area_origem_id, area_atual_id),
        updated_at = now()
      WHERE id = v_row.animal_id AND company_id = p_company_id;
    ELSE
      UPDATE erp_pec_animal SET
        status           = COALESCE(nullif(v_snap->>'status',''), 'ativo'),
        ativo            = COALESCE((v_snap->>'ativo')::boolean, true),
        data_saida       = nullif(v_snap->>'data_saida','')::date,
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

-- ── ESTORNAR (parcial ou total). p_animal_ids NULL → grupo todo (retrocompatível #880). ──────────
CREATE OR REPLACE FUNCTION public.fn_pec_movimentacao_estornar(p_company_id uuid, p_grupo_id uuid, p_motivo text, p_animal_ids uuid[] DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_parcial boolean := p_animal_ids IS NOT NULL;
  v_ids uuid[]; v_animais uuid[]; v_refs text[];
  v_tipo text; v_prop uuid; v_valor numeric; v_qtd int;
  v_total int; v_est_total int; v_restantes numeric;
  v_receber uuid; v_receber_status text; v_cancelou boolean := false; v_reduziu boolean := false;
  v_estorno_id uuid := gen_random_uuid();   -- id próprio do registro de estorno (ref única · uq_pec_mov_ref)
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  IF length(btrim(coalesce(p_motivo,''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo do estorno');  -- RD-55
  END IF;

  -- linhas ELEGÍVEIS: animais do grupo, não deletados, ainda NÃO estornados (previne duplo estorno),
  -- filtrados por p_animal_ids se veio (parcial).
  SELECT array_agg(id), array_agg(animal_id), COALESCE(sum(valor),0), count(*), max(tipo), (array_agg(propriedade_id))[1]
    INTO v_ids, v_animais, v_valor, v_qtd, v_tipo, v_prop
  FROM erp_pec_movimentacao
  WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL
    AND animal_id IS NOT NULL AND estornada = false
    AND (p_animal_ids IS NULL OR animal_id = ANY(p_animal_ids));
  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhum animal elegível para estorno (já estornados?)');
  END IF;

  SELECT count(*) INTO v_total FROM erp_pec_movimentacao
   WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL AND animal_id IS NOT NULL;

  -- refs p/ casar a receita (grupo_id novo OU ids das linhas — legado): todas as linhas de animal + grupo.
  SELECT array_agg(id::text) || ARRAY[p_grupo_id::text] INTO v_refs FROM erp_pec_movimentacao
   WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL AND animal_id IS NOT NULL;

  -- (a) reverte SÓ os animais elegíveis (RD-55).
  PERFORM public.fn_pec_mov_reverter_animais(p_company_id, p_grupo_id, v_animais);

  -- (b) marca as linhas estornadas (não apaga · RD-55).
  UPDATE erp_pec_movimentacao SET
    estornada = true, estornada_em = now(), estornada_por = auth.uid(), motivo_estorno = btrim(p_motivo), updated_at = now()
  WHERE id = ANY(v_ids);

  -- (c) financeiro proporcional (RD-51): a receita passa a valer o total dos animais AINDA ativos.
  SELECT count(*) FILTER (WHERE estornada), COALESCE(sum(valor) FILTER (WHERE estornada = false), 0)
    INTO v_est_total, v_restantes
  FROM erp_pec_movimentacao
   WHERE company_id = p_company_id AND COALESCE(grupo_id, id) = p_grupo_id AND deleted_at IS NULL AND animal_id IS NOT NULL;

  SELECT id, status INTO v_receber, v_receber_status FROM erp_receber
   WHERE company_id = p_company_id AND ref_externa_sistema = 'pecuaria' AND ref_externa_id = ANY (v_refs)
   ORDER BY created_at DESC LIMIT 1;
  IF v_receber IS NOT NULL AND v_receber_status <> 'pago' THEN   -- nunca mexe em parcela paga (#880)
    IF v_restantes <= 0 THEN
      UPDATE erp_receber SET status = 'cancelado', updated_at = now() WHERE id = v_receber; v_cancelou := true;
    ELSE
      UPDATE erp_receber SET valor = v_restantes, updated_at = now() WHERE id = v_receber; v_reduziu := true;
    END IF;
  END IF;

  -- (d) registro de estorno com valor negativo PROPORCIONAL (rastro contábil).
  -- ref única por registro (uq_pec_mov_ref); a origem (venda estornada) fica no texto e em grupo_origem via observacao.
  INSERT INTO erp_pec_movimentacao (company_id, propriedade_id, grupo_id, tipo, data, quantidade, valor,
    observacao, ref_externa_sistema, ref_externa_id, criado_por)
  VALUES (p_company_id, v_prop, v_estorno_id, 'estorno', CURRENT_DATE, v_qtd, -v_valor,
    'Estorno' || CASE WHEN v_est_total < v_total THEN ' parcial' ELSE '' END || ' de ' || v_tipo || ': ' || btrim(p_motivo)
      || ' (' || v_qtd || ' de ' || v_total || ') · origem ' || p_grupo_id::text,
    'estorno_mov', v_estorno_id::text, auth.uid());

  RETURN jsonb_build_object('ok', true, 'tipo', v_tipo, 'parcial', (v_est_total < v_total),
    'animais_revertidos', v_qtd, 'valor_estornado', v_valor,
    'restantes_ativos', v_total - v_est_total, 'total_animais', v_total,
    'receita_cancelada', v_cancelou, 'receita_reduzida', v_reduziu,
    'valor_receita_restante', GREATEST(v_restantes, 0));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_movimentacao_estornar(uuid, uuid, text, uuid[]) TO authenticated;

-- ── LISTA: reflete estado misto (intacta / parcial / estornada) · RD-51. ────────────────────────
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
           count(*) FILTER (WHERE m.animal_id IS NOT NULL AND m.estornada) AS qtd_estornada,
           max(m.contraparte_nome) AS contraparte_nome,
           COALESCE(sum(m.valor), 0) AS valor,
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
    GROUP BY COALESCE(m.grupo_id, m.id)
  ), gv AS (
    SELECT g.*, (g.qtd - g.qtd_estornada) AS qtd_ativos,
      CASE WHEN g.qtd = 0 OR g.qtd_estornada = 0 THEN 'intacta'
           WHEN g.qtd_estornada >= g.qtd THEN 'estornada' ELSE 'parcial' END AS estado
    FROM g
    WHERE (p_incluir_estornadas OR NOT (g.qtd > 0 AND g.qtd_estornada >= g.qtd))
    ORDER BY g.data DESC, g.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,300), 1000))
  ), gf AS (
    SELECT gv.*, r.id AS receber_id, r.status AS fin_status
    FROM gv
    LEFT JOIN LATERAL (
      SELECT r.id, r.status FROM erp_receber r
      WHERE r.company_id = p_company_id AND r.ref_externa_sistema = 'pecuaria'
        AND r.ref_externa_id = ANY (gv.mov_ids || ARRAY[gv.gkey::text])
      ORDER BY r.created_at DESC LIMIT 1
    ) r ON true
  )
  SELECT jsonb_build_object('ok', true, 'movimentacoes', COALESCE(jsonb_agg(jsonb_build_object(
    'grupo_id', gkey, 'tipo', tipo, 'data', data, 'created_at', created_at,
    'qtd', qtd, 'qtd_ativos', qtd_ativos, 'qtd_estornada', qtd_estornada, 'estado', estado,
    'contraparte_nome', contraparte_nome, 'valor', valor,
    'lote_origem', lote_origem, 'lote_destino', lote_destino, 'area_origem', area_origem, 'area_destino', area_destino,
    'estornada', estado = 'estornada', 'tem_financeiro', receber_id IS NOT NULL, 'financeiro_status', fin_status
  ) ORDER BY data DESC, created_at DESC), '[]'::jsonb)) INTO v_out
  FROM gf;
  RETURN v_out;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_pec_movimentacoes_listar(uuid, uuid, text, date, date, uuid, uuid, boolean, int) TO authenticated;

-- ── DETALHE: por animal devolve linha_estornada (p/ checkbox desabilitar quem já foi) + estado do grupo.
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
    'qtd_estornada', count(*) FILTER (WHERE m.animal_id IS NOT NULL AND m.estornada),
    'qtd_ativos', count(*) FILTER (WHERE m.animal_id IS NOT NULL AND NOT m.estornada),
    'contraparte_nome', max(m.contraparte_nome), 'valor', COALESCE(sum(m.valor),0),
    'peso_kg', sum(m.peso_kg), 'observacao', max(m.observacao),
    'lote_origem', max(lo.codigo), 'lote_destino', max(ld.codigo),
    'estornada', bool_and(m.estornada) FILTER (WHERE m.animal_id IS NOT NULL),
    'motivo_estorno', max(m.motivo_estorno), 'estornada_em', max(m.estornada_em)
  ) INTO v_head
  FROM erp_pec_movimentacao m
  LEFT JOIN erp_pec_lote lo ON lo.id = m.lote_id
  LEFT JOIN erp_pec_lote ld ON ld.id = m.lote_destino_id
  WHERE m.company_id = p_company_id AND COALESCE(m.grupo_id, m.id) = p_grupo_id AND m.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'animal_id', a.id, 'identificacao', a.identificacao, 'status', a.status, 'ativo', a.ativo,
    'valor', m.valor, 'linha_estornada', m.estornada) ORDER BY a.identificacao), '[]'::jsonb) INTO v_animais
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
