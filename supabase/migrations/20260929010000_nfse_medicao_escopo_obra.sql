-- #340 (R.R · Rodrigo) · NFS-e por medição não abatia do escopo contratado da obra. Havia dois conceitos de medição
-- desconectados: as parcelas do pedido (#35, cronograma FINANCEIRO) e o escopo da obra no Hub
-- (projetos_obra_item: quantidade_contratada × preco_unitario, quantidade_medida acumulando). Nenhuma função ligava a
-- emissão da nota à quantidade_medida. Esta migration liga, no MESMO padrão das parcelas (validar → vincular →
-- lançar na autorização):
--
--  (1) fn_nfse_obra_medicao_validar — ANTES de emitir: itens da obra (da empresa, não excluídos), quantidade > 0 e
--      dentro do que falta medir (contratada − medida − o que outra nota ainda pendente já reservou), e a soma
--      (quantidade × preço unitário) = valor da nota, tolerância R$ 0,01 (DECISÃO DO CEO 29/09). A mensagem diz
--      quanto falta ou sobra.
--  (2) fn_nfse_obra_medicao_vincular — DEPOIS de registrar a nota: grava os itens medidos (status 'pendente').
--      Nota que já volta autorizada lança na hora.
--  (3) gatilho trg_nfse_obra_medicao — a medição só é LANÇADA com a nota AUTORIZADA; nota REJEITADA não lança
--      nada (pendentes viram 'descartada'); nota CANCELADA estorna a quantidade medida (DECISÃO DO CEO 29/09).
--  (4) fn_obra_linha_do_tempo — mostra cada medição lançada e cada ESTORNO, com o número da nota (decisão do CEO:
--      "o estorno fica registrado no histórico da obra com o número da nota cancelada").
-- Nada roda sobre dado existente: 0 itens de escopo medidos hoje (6 itens, todos da R.R, quantidade_medida = 0).

CREATE TABLE IF NOT EXISTS public.erp_nfse_obra_medicao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  nfse_id       uuid NOT NULL REFERENCES public.erp_nfse_emitidas(id),
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id),
  obra_item_id  uuid NOT NULL REFERENCES public.projetos_obra_item(id),
  quantidade    numeric(18,4) NOT NULL CHECK (quantidade > 0),
  preco_unitario numeric(18,4) NOT NULL,
  valor         numeric(14,2) NOT NULL,
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','lancada','descartada','estornada')),
  numero_nf     text,
  lancada_em    timestamptz,
  estornada_em  timestamptz,
  descartada_em timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nfse_id, obra_item_id)
);
CREATE INDEX IF NOT EXISTS erp_nfse_obra_medicao_obra_idx ON public.erp_nfse_obra_medicao (obra_id, status);
CREATE INDEX IF NOT EXISTS erp_nfse_obra_medicao_item_idx ON public.erp_nfse_obra_medicao (obra_item_id, status);
COMMENT ON TABLE public.erp_nfse_obra_medicao IS
  '#340 · itens do escopo da obra medidos por NFS-e. pendente → lancada (nota autorizada) → estornada (nota cancelada); pendente → descartada (nota rejeitada). Escrita só pelas funções fn_nfse_obra_medicao_* e pelo gatilho.';

ALTER TABLE public.erp_nfse_obra_medicao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_nfse_obra_medicao_select ON public.erp_nfse_obra_medicao;
CREATE POLICY erp_nfse_obra_medicao_select ON public.erp_nfse_obra_medicao
  FOR SELECT TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_nfse_obra_medicao FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.erp_nfse_obra_medicao FROM authenticated;
GRANT SELECT ON public.erp_nfse_obra_medicao TO authenticated;

-- valor em reais no formato brasileiro (1.000.500,00) para as mensagens e a linha do tempo
CREATE OR REPLACE FUNCTION public.fn_brl(p numeric)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT translate(to_char(round(COALESCE(p,0),2), 'FM999,999,999,990.00'), ',.', '.,');
$function$;

-- recalcula o valor medido da obra a partir dos itens (o mesmo número que fn_obra_escopo mostra)
CREATE OR REPLACE FUNCTION public.fn_obra_recalcular_medido(p_obra_id uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE projetos_obras o SET valor_medido = COALESCE((
    SELECT round(sum(i.quantidade_medida * i.preco_unitario), 2) FROM projetos_obra_item i
     WHERE i.obra_id = o.id AND i.excluido_em IS NULL), 0), updated_at = now()
   WHERE o.id = p_obra_id;
$function$;
REVOKE ALL ON FUNCTION public.fn_obra_recalcular_medido(uuid) FROM PUBLIC, anon, authenticated;

-- (1) validação antes de emitir -----------------------------------------------------------------------------
-- p_itens: [{ "item_id": uuid, "quantidade": numeric }]
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_medicao_validar(
  p_company_id uuid, p_obra_id uuid, p_itens jsonb, p_valor numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_obra record; v_it jsonb; v_item record; v_qtd numeric; v_reservado numeric; v_disp numeric;
        v_soma numeric := 0; v_n int := 0; v_dif numeric;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT id, company_id, numero INTO v_obra FROM projetos_obras WHERE id = p_obra_id;
  IF v_obra.id IS NULL OR v_obra.company_id <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada nesta empresa.');
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe ao menos um item do escopo medido nesta nota.');
  END IF;
  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := NULLIF(v_it->>'quantidade','')::numeric;
    SELECT id, descricao, quantidade_contratada, quantidade_medida, preco_unitario INTO v_item
      FROM projetos_obra_item WHERE id = (v_it->>'item_id')::uuid AND obra_id = p_obra_id AND excluido_em IS NULL;
    IF v_item.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item que não é do escopo desta obra.'); END IF;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', format('Informe a quantidade medida de "%s".', v_item.descricao));
    END IF;
    -- o que outra nota em andamento (pendente) já reservou deste item também conta
    SELECT COALESCE(sum(m.quantidade),0) INTO v_reservado FROM erp_nfse_obra_medicao m
      JOIN erp_nfse_emitidas n ON n.id = m.nfse_id
     WHERE m.obra_item_id = v_item.id AND m.status = 'pendente' AND n.status IN ('processando','autorizada');
    v_disp := GREATEST(v_item.quantidade_contratada - v_item.quantidade_medida - v_reservado, 0);
    IF v_qtd > v_disp + 0.00005 THEN
      RETURN jsonb_build_object('ok', false, 'erro', format('"%s": a medição (%s) passa do que falta medir (%s).',
        v_item.descricao, trim(to_char(v_qtd,'FM999999990.0999')), trim(to_char(v_disp,'FM999999990.0999'))));
    END IF;
    v_soma := v_soma + round(v_qtd * v_item.preco_unitario, 2);
    v_n := v_n + 1;
  END LOOP;
  v_dif := round(COALESCE(p_valor,0) - v_soma, 2);
  IF abs(v_dif) > 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'soma', v_soma, 'diferenca', v_dif, 'erro', format(
      'Os itens medidos somam R$ %s e a nota é de R$ %s: %s R$ %s nos itens.',
      public.fn_brl(v_soma), public.fn_brl(COALESCE(p_valor,0)),
      CASE WHEN v_dif > 0 THEN 'faltam' ELSE 'sobram' END, public.fn_brl(abs(v_dif))));
  END IF;
  RETURN jsonb_build_object('ok', true, 'soma', v_soma, 'itens', v_n);
END $function$;

-- lança os itens pendentes de uma nota autorizada (idempotente: só pega 'pendente')
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_medicao_lancar(p_nfse_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_num text; v_n int := 0; v_obra uuid;
BEGIN
  SELECT numero INTO v_num FROM erp_nfse_emitidas WHERE id = p_nfse_id;
  WITH l AS (
    UPDATE erp_nfse_obra_medicao SET status = 'lancada', lancada_em = now(), numero_nf = v_num
     WHERE nfse_id = p_nfse_id AND status = 'pendente' RETURNING obra_item_id, quantidade, obra_id)
  , u AS (
    UPDATE projetos_obra_item i SET quantidade_medida = i.quantidade_medida + l.quantidade, atualizado_em = now()
      FROM l WHERE i.id = l.obra_item_id RETURNING l.obra_id)
  SELECT count(*), min(obra_id::text)::uuid INTO v_n, v_obra FROM u;
  IF v_obra IS NOT NULL THEN PERFORM public.fn_obra_recalcular_medido(v_obra); END IF;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.fn_nfse_obra_medicao_lancar(uuid) FROM PUBLIC, anon, authenticated;

-- (2) vínculo depois de registrar a nota --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_medicao_vincular(p_nfse_id uuid, p_obra_id uuid, p_itens jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n record; v_ins int; v_lanc int := 0;
BEGIN
  SELECT id, company_id, status INTO v_n FROM erp_nfse_emitidas WHERE id = p_nfse_id;
  IF v_n.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nota não encontrada'); END IF;
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND v_n.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projetos_obras WHERE id = p_obra_id AND company_id = v_n.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra de outra empresa');
  END IF;
  INSERT INTO erp_nfse_obra_medicao (company_id, nfse_id, obra_id, obra_item_id, quantidade, preco_unitario, valor, status)
  SELECT v_n.company_id, p_nfse_id, p_obra_id, i.id, (e->>'quantidade')::numeric, i.preco_unitario,
         round((e->>'quantidade')::numeric * i.preco_unitario, 2),
         CASE WHEN v_n.status IN ('rejeitada','erro') THEN 'descartada' ELSE 'pendente' END
    FROM jsonb_array_elements(p_itens) e
    JOIN projetos_obra_item i ON i.id = (e->>'item_id')::uuid AND i.obra_id = p_obra_id AND i.excluido_em IS NULL
   WHERE (e->>'quantidade')::numeric > 0
  ON CONFLICT (nfse_id, obra_item_id) DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  -- autorização síncrona: o gatilho só pega a TRANSIÇÃO de status; a nota que já nasceu autorizada lança aqui
  IF v_n.status = 'autorizada' THEN v_lanc := public.fn_nfse_obra_medicao_lancar(p_nfse_id); END IF;
  RETURN jsonb_build_object('ok', true, 'itens', v_ins, 'lancados', v_lanc);
END $function$;

-- (3) gatilho: autorizada lança · rejeitada descarta · cancelada estorna ---------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_nfse_obra_medicao()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_obra uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_nfse_obra_medicao WHERE nfse_id = NEW.id) THEN RETURN NEW; END IF;
  IF NEW.status = 'autorizada' THEN
    PERFORM public.fn_nfse_obra_medicao_lancar(NEW.id);
  ELSIF NEW.status IN ('rejeitada','erro') THEN
    UPDATE erp_nfse_obra_medicao SET status = 'descartada', descartada_em = now()
     WHERE nfse_id = NEW.id AND status = 'pendente';
  ELSIF NEW.status = 'cancelada' THEN
    WITH e AS (
      UPDATE erp_nfse_obra_medicao SET status = 'estornada', estornada_em = now(), numero_nf = COALESCE(numero_nf, NEW.numero)
       WHERE nfse_id = NEW.id AND status = 'lancada' RETURNING obra_item_id, quantidade, obra_id)
    , u AS (
      UPDATE projetos_obra_item i SET quantidade_medida = GREATEST(i.quantidade_medida - e.quantidade, 0), atualizado_em = now()
        FROM e WHERE i.id = e.obra_item_id RETURNING e.obra_id)
    SELECT min(obra_id::text)::uuid INTO v_obra FROM u;
    -- pendente de nota cancelada antes de autorizar: nunca lançou, só descarta
    UPDATE erp_nfse_obra_medicao SET status = 'descartada', descartada_em = now() WHERE nfse_id = NEW.id AND status = 'pendente';
    IF v_obra IS NOT NULL THEN PERFORM public.fn_obra_recalcular_medido(v_obra); END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_nfse_obra_medicao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_nfse_obra_medicao ON public.erp_nfse_emitidas;
CREATE TRIGGER trg_nfse_obra_medicao
AFTER UPDATE OF status ON public.erp_nfse_emitidas
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_nfse_obra_medicao();

-- (4) linha do tempo da obra: medições lançadas e estornadas, com o número da nota ----------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_linha_do_tempo(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_obra record; v_eventos jsonb;
BEGIN
  SELECT * INTO v_obra FROM projetos_obras WHERE id = p_obra_id;
  IF v_obra.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra_nao_encontrada'); END IF;
  IF v_obra.company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH ev AS (
    SELECT h.criado_em AS quando, 'oportunidade' AS fase, h.acao AS tipo, h.detalhe AS descricao, h.autor_id
      FROM erp_crm_oportunidade_historico h WHERE h.oportunidade_id = v_obra.oportunidade_id
    UNION ALL
    SELECT COALESCE(v.data_visita, v.created_at), 'levantamento', 'visita_' || v.status,
           'Visita técnica ' || v.status || COALESCE(' · ' || NULLIF(btrim(v.anotacoes),''), ''), v.responsavel_id
      FROM erp_crm_visita v WHERE v.oportunidade_id = v_obra.oportunidade_id
    UNION ALL
    SELECT p.created_at, 'levantamento', 'planta_' || COALESCE(p.status,'enviada'),
           'Planta ' || COALESCE(p.nome,'') || COALESCE(' · ' || p.area_total_m2::text || ' m²', ''), p.criado_por
      FROM erp_obra_planta p WHERE p.orcamento_id = v_obra.orcamento_id
    UNION ALL
    SELECT oh.created_at, 'orcamento', oh.evento, COALESCE(oh.detalhe, oh.evento), oh.usuario_id
      FROM erp_orcamento_historico oh WHERE oh.orcamento_id = v_obra.orcamento_id
    UNION ALL
    SELECT v_obra.created_at, 'obra', 'obra_criada',
           'Obra ' || v_obra.numero || ' criada a partir do orçamento', v_obra.created_by
    UNION ALL
    SELECT v_obra.escopo_congelado_em, 'obra', 'escopo_congelado',
           'Escopo congelado · ' || (SELECT count(*)::text FROM projetos_obra_item i WHERE i.obra_id = v_obra.id AND i.excluido_em IS NULL) || ' itens',
           v_obra.created_by
     WHERE v_obra.escopo_congelado_em IS NOT NULL
    UNION ALL
    -- #340 · medição lançada pela NFS-e autorizada (uma linha por nota)
    SELECT min(m.lancada_em), 'obra', 'medicao_nfse',
           'Medição pela NFS-e nº ' || COALESCE(max(m.numero_nf),'s/n') || ' · ' || count(*)::text || ' item(ns) · R$ ' || public.fn_brl(sum(m.valor)),
           NULL::uuid
      FROM erp_nfse_obra_medicao m WHERE m.obra_id = v_obra.id AND m.lancada_em IS NOT NULL
     GROUP BY m.nfse_id
    UNION ALL
    -- #340 · estorno da medição da nota cancelada (decisão do CEO: com o número da nota cancelada)
    SELECT min(m.estornada_em), 'obra', 'medicao_estornada',
           'Medição estornada: NFS-e nº ' || COALESCE(max(m.numero_nf),'s/n') || ' cancelada · R$ ' || public.fn_brl(sum(m.valor)) || ' devolvidos ao escopo',
           NULL::uuid
      FROM erp_nfse_obra_medicao m WHERE m.obra_id = v_obra.id AND m.status = 'estornada'
     GROUP BY m.nfse_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'quando', ev.quando, 'fase', ev.fase, 'tipo', ev.tipo, 'descricao', ev.descricao,
           'autor', COALESCE(u.full_name, u.email, '—')
         ) ORDER BY ev.quando), '[]'::jsonb)
  INTO v_eventos FROM ev LEFT JOIN v_users_with_roles u ON u.user_id = ev.autor_id
  WHERE ev.quando IS NOT NULL;
  RETURN jsonb_build_object('ok', true,
    'obra', jsonb_build_object('id', v_obra.id, 'numero', v_obra.numero, 'nome', v_obra.nome,
      'cliente', v_obra.cliente_nome, 'status', v_obra.status,
      'valor_previsto', v_obra.valor_previsto, 'valor_medido', v_obra.valor_medido,
      'centro_custo_id', v_obra.centro_custo_id, 'data_inicio', v_obra.data_inicio),
    'eventos', v_eventos, 'total_eventos', jsonb_array_length(v_eventos));
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfse_obra_medicao_validar(uuid, uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_obra_medicao_validar(uuid, uuid, jsonb, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_nfse_obra_medicao_vincular(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_obra_medicao_vincular(uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_obra_linha_do_tempo(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_obra_linha_do_tempo(uuid) TO authenticated;
