-- Chamado #2711 (Rodrigo, projeto de encerrar o OMIE): a sync com o OMIE é upsert-only e não remove do ERP o que foi
-- excluído no OMIE -> lançamentos fantasma ficam abertos/atrasados (R.R d1330faf: 3 lançamentos Supreme Garden, R$ 49.500).
-- Prova no dado (RD-38): erp_pagar/erp_receber guardam o código do OMIE em ref_externa_id com ref_externa_sistema = 'OMIE'
-- (maiúsculo); o último snapshot completo está em omie_imports (import_type contas_pagar / contas_receber), em
-- import_data->'conta_pagar_cadastro' / 'conta_receber_cadastro', cada item com codigo_lancamento_omie.
--
-- Esta migration só CRIA funções; não altera nenhum dado. Duas funções:
--   fn_omie_reconciliar_relatorio(p_company)  — SÓ LEITURA: por empresa × tipo, ERP vs OMIE e divergências.
--   fn_omie_reconciliar_aplicar(p_company, p_tipo) — marca como removido (deleted_at + observação) os ausentes do snapshot.
-- Travas do aplicar (exclusão em massa de dado de cliente — revisão do gilberto-revisor):
--   * empresa e tipo explícitos (nunca "todas de uma vez"); só PS_ADMIN/PS_ADMIN_CVM ou conexão de serviço;
--   * só com snapshot COMPLETO (itens = total_de_registros; sem paginação parcial; abaixo do teto de 10.000);
--   * nunca remove título PAGO/baixado, nem lançamento importado/criado DEPOIS do snapshot, nem já removido;
--   * soft delete (deleted_at, deleted_by, observação com a data do snapshot) — reversível, nada apagado de verdade.

CREATE OR REPLACE FUNCTION public.fn__omie_snapshot_ids(p_company uuid, p_tipo text)
RETURNS TABLE (imported_at timestamptz, completo boolean, ids text[])
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_chave text := CASE p_tipo WHEN 'pagar' THEN 'conta_pagar_cadastro' WHEN 'receber' THEN 'conta_receber_cadastro' END;
  v_tipo  text := CASE p_tipo WHEN 'pagar' THEN 'contas_pagar' WHEN 'receber' THEN 'contas_receber' END;
  r       record;
  v_len   int;
BEGIN
  IF v_chave IS NULL THEN
    RAISE EXCEPTION 'tipo inválido: use pagar ou receber';
  END IF;
  SELECT i.* INTO r FROM public.omie_imports i
   WHERE i.company_id = p_company AND i.import_type = v_tipo
   ORDER BY i.imported_at DESC LIMIT 1;
  IF NOT FOUND OR jsonb_typeof(r.import_data -> v_chave) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;
  v_len := jsonb_array_length(r.import_data -> v_chave);
  imported_at := r.imported_at;
  completo := v_len > 0
    AND v_len < 10000
    AND (r.import_data ->> 'total_de_registros' IS NULL OR (r.import_data ->> 'total_de_registros')::int = v_len)
    AND (r.import_data ->> 'paginas_importadas' IS NULL
         OR r.import_data ->> 'total_de_paginas' IS NULL
         OR (r.import_data ->> 'paginas_importadas')::int >= (r.import_data ->> 'total_de_paginas')::int);
  SELECT array_agg(DISTINCT e ->> 'codigo_lancamento_omie') INTO ids
    FROM jsonb_array_elements(r.import_data -> v_chave) e
   WHERE e ->> 'codigo_lancamento_omie' IS NOT NULL;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn__omie_reconciliar_autorizado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NULL
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN', 'PS_ADMIN_CVM'))
$$;

CREATE OR REPLACE FUNCTION public.fn_omie_reconciliar_relatorio(p_company uuid DEFAULT NULL)
RETURNS TABLE (
  company_id uuid, tipo text, snapshot_em timestamptz, snapshot_completo boolean,
  qtd_omie int, qtd_erp int, total_erp numeric,
  ausentes_qtd int, ausentes_total numeric,
  removiveis_qtd int, removiveis_total numeric,
  protegidos_qtd int, protegidos_total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp  uuid;
  v_tipo text;
  s      record;
BEGIN
  IF NOT public.fn__omie_reconciliar_autorizado() THEN
    RAISE EXCEPTION 'Sem permissão: relatório de reconciliação do OMIE é só da equipe PS.';
  END IF;
  FOR v_emp IN
    SELECT DISTINCT i.company_id FROM public.omie_imports i
     WHERE i.import_type IN ('contas_pagar', 'contas_receber') AND (p_company IS NULL OR i.company_id = p_company)
  LOOP
    FOREACH v_tipo IN ARRAY ARRAY['pagar', 'receber'] LOOP
      SELECT * INTO s FROM public.fn__omie_snapshot_ids(v_emp, v_tipo);
      IF s.imported_at IS NULL THEN CONTINUE; END IF;
      company_id := v_emp; tipo := v_tipo; snapshot_em := s.imported_at; snapshot_completo := s.completo;
      qtd_omie := coalesce(array_length(s.ids, 1), 0);
      IF v_tipo = 'pagar' THEN
        SELECT count(*), coalesce(sum(t.valor), 0),
               count(*) FILTER (WHERE t.ref_externa_id <> ALL (s.ids)),
               coalesce(sum(t.valor) FILTER (WHERE t.ref_externa_id <> ALL (s.ids)), 0),
               count(*) FILTER (WHERE t.ref_externa_id <> ALL (s.ids) AND NOT (lower(coalesce(t.status,'')) IN ('pago','paga') OR coalesce(t.valor_pago,0) > 0 OR coalesce(t.importado_em, t.created_at) > s.imported_at)),
               coalesce(sum(t.valor) FILTER (WHERE t.ref_externa_id <> ALL (s.ids) AND NOT (lower(coalesce(t.status,'')) IN ('pago','paga') OR coalesce(t.valor_pago,0) > 0 OR coalesce(t.importado_em, t.created_at) > s.imported_at)), 0)
          INTO qtd_erp, total_erp, ausentes_qtd, ausentes_total, removiveis_qtd, removiveis_total
          FROM public.erp_pagar t
         WHERE t.company_id = v_emp AND upper(t.ref_externa_sistema) = 'OMIE' AND t.deleted_at IS NULL AND t.ref_externa_id IS NOT NULL;
      ELSE
        SELECT count(*), coalesce(sum(t.valor), 0),
               count(*) FILTER (WHERE t.ref_externa_id <> ALL (s.ids)),
               coalesce(sum(t.valor) FILTER (WHERE t.ref_externa_id <> ALL (s.ids)), 0),
               count(*) FILTER (WHERE t.ref_externa_id <> ALL (s.ids) AND NOT (lower(coalesce(t.status,'')) IN ('pago','paga','recebido') OR coalesce(t.valor_pago,0) > 0 OR coalesce(t.importado_em, t.created_at) > s.imported_at)),
               coalesce(sum(t.valor) FILTER (WHERE t.ref_externa_id <> ALL (s.ids) AND NOT (lower(coalesce(t.status,'')) IN ('pago','paga','recebido') OR coalesce(t.valor_pago,0) > 0 OR coalesce(t.importado_em, t.created_at) > s.imported_at)), 0)
          INTO qtd_erp, total_erp, ausentes_qtd, ausentes_total, removiveis_qtd, removiveis_total
          FROM public.erp_receber t
         WHERE t.company_id = v_emp AND upper(t.ref_externa_sistema) = 'OMIE' AND t.deleted_at IS NULL AND t.ref_externa_id IS NOT NULL;
      END IF;
      protegidos_qtd := ausentes_qtd - removiveis_qtd;
      protegidos_total := ausentes_total - removiveis_total;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_omie_reconciliar_aplicar(p_company uuid, p_tipo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s      record;
  v_obs  text;
  v_qtd  int;
  v_tot  numeric;
BEGIN
  IF NOT public.fn__omie_reconciliar_autorizado() THEN
    RAISE EXCEPTION 'Sem permissão: só a equipe PS aplica a reconciliação do OMIE.';
  END IF;
  IF p_company IS NULL OR p_tipo NOT IN ('pagar', 'receber') THEN
    RAISE EXCEPTION 'Informe a empresa e o tipo (pagar ou receber).';
  END IF;
  SELECT * INTO s FROM public.fn__omie_snapshot_ids(p_company, p_tipo);
  IF s.imported_at IS NULL OR NOT s.completo THEN
    RAISE EXCEPTION 'Snapshot do OMIE ausente ou incompleto para esta empresa/tipo: reimporte antes de reconciliar.';
  END IF;
  v_obs := format('[Reconciliação OMIE %s] ausente do snapshot de %s; removido do ERP (chamado #2711).',
                  to_char(now(), 'DD/MM/YYYY'), to_char(s.imported_at, 'DD/MM/YYYY'));

  IF p_tipo = 'pagar' THEN
    WITH alvo AS (
      UPDATE public.erp_pagar t SET deleted_at = now(), deleted_by = auth.uid(),
             observacoes = btrim(coalesce(t.observacoes, '') || ' ' || v_obs), updated_at = now()
       WHERE t.company_id = p_company AND upper(t.ref_externa_sistema) = 'OMIE' AND t.deleted_at IS NULL
         AND t.ref_externa_id IS NOT NULL AND t.ref_externa_id <> ALL (s.ids)
         AND lower(coalesce(t.status, '')) NOT IN ('pago', 'paga') AND coalesce(t.valor_pago, 0) = 0
         AND coalesce(t.importado_em, t.created_at) <= s.imported_at
       RETURNING t.valor)
    SELECT count(*), coalesce(sum(valor), 0) INTO v_qtd, v_tot FROM alvo;
  ELSE
    WITH alvo AS (
      UPDATE public.erp_receber t SET deleted_at = now(), deleted_by = auth.uid(),
             observacoes = btrim(coalesce(t.observacoes, '') || ' ' || v_obs), updated_at = now()
       WHERE t.company_id = p_company AND upper(t.ref_externa_sistema) = 'OMIE' AND t.deleted_at IS NULL
         AND t.ref_externa_id IS NOT NULL AND t.ref_externa_id <> ALL (s.ids)
         AND lower(coalesce(t.status, '')) NOT IN ('pago', 'paga', 'recebido') AND coalesce(t.valor_pago, 0) = 0
         AND coalesce(t.importado_em, t.created_at) <= s.imported_at
       RETURNING t.valor)
    SELECT count(*), coalesce(sum(valor), 0) INTO v_qtd, v_tot FROM alvo;
  END IF;

  INSERT INTO public.audit_log_global (company_id, tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES (p_company, 'erp_' || p_tipo, 'omie_reconciliar_aplicar', p_company::text,
          jsonb_build_object('tipo', p_tipo, 'removidos', v_qtd, 'total', v_tot, 'snapshot_em', s.imported_at), auth.uid(), now());

  RETURN jsonb_build_object('ok', true, 'company_id', p_company, 'tipo', p_tipo, 'removidos', v_qtd, 'total', v_tot, 'snapshot_em', s.imported_at);
END;
$$;

REVOKE ALL ON FUNCTION public.fn__omie_snapshot_ids(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__omie_reconciliar_autorizado() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_omie_reconciliar_relatorio(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_omie_reconciliar_aplicar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__omie_snapshot_ids(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn__omie_reconciliar_autorizado() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_omie_reconciliar_relatorio(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_omie_reconciliar_aplicar(uuid, text) TO authenticated, service_role;
