-- Financeiro/OMIE · BUG #13: título cancelado no OMIE continua inadimplente. Fronteira GE.
--
-- Premissa corrigida (RD-38/RD-51): o vínculo JÁ é gravado (erp_receber.ref_externa_id =
-- codigo_lancamento_omie, ref_externa_sistema='OMIE' — 1832 recebíveis; o origem_recebivel_id do
-- SPEC é coluna legada sem uso). E o ETL JÁ atualiza status no re-sync (ON CONFLICT DO UPDATE).
-- A causa raiz é o MAP de status em fn_etl_omie_empresa: o CASE não tinha o ramo 'CANCELADO' →
-- os 76 títulos CANCELADO do OMIE caíam no ELSE 'aberto' → presos como inadimplentes.
--
-- 13a: adiciona 'CANCELADO' → 'cancelado' no ETL (pagar e receber) + marca os já importados.
-- 13b: fn_receber_cancelar (gated, com log) pro cancelamento manual defensivo.

-- 13a-1) ETL: acrescenta o ramo CANCELADO no status (programático, idempotente).
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fn_etl_omie_empresa(uuid)'::regprocedure);
  IF d NOT ILIKE '%''CANCELADO'' THEN ''cancelado''%' THEN
    d := replace(d, 'WHEN cp->>''status_titulo'' = ''VENCIDO'' THEN ''vencido''',
                    'WHEN cp->>''status_titulo'' = ''VENCIDO'' THEN ''vencido''' || chr(10) ||
                    '             WHEN cp->>''status_titulo'' = ''CANCELADO'' THEN ''cancelado''');
    d := replace(d, 'WHEN cr->>''status_titulo'' = ''VENCIDO'' THEN ''vencido''',
                    'WHEN cr->>''status_titulo'' = ''VENCIDO'' THEN ''vencido''' || chr(10) ||
                    '             WHEN cr->>''status_titulo'' = ''CANCELADO'' THEN ''cancelado''');
    EXECUTE d;
  END IF;
END
$mig$;

-- 13a-2) Backfill: marca cancelado os já importados cujo título no OMIE está CANCELADO (match por ref).
UPDATE public.erp_receber er SET status = 'cancelado', updated_at = now()
FROM omie_imports oi, jsonb_array_elements(oi.import_data->'conta_receber_cadastro') cr
WHERE oi.import_type = 'contas_receber' AND oi.company_id = er.company_id
  AND er.ref_externa_sistema = 'OMIE' AND er.ref_externa_id = cr->>'codigo_lancamento_omie'
  AND cr->>'status_titulo' = 'CANCELADO'
  AND er.deleted_at IS NULL AND er.status <> 'cancelado';

UPDATE public.erp_pagar ep SET status = 'cancelado', updated_at = now()
FROM omie_imports oi, jsonb_array_elements(oi.import_data->'conta_pagar_cadastro') cp
WHERE oi.import_type = 'contas_pagar' AND oi.company_id = ep.company_id
  AND ep.ref_externa_sistema = 'OMIE' AND ep.ref_externa_id = cp->>'codigo_lancamento_omie'
  AND cp->>'status_titulo' = 'CANCELADO'
  AND ep.deleted_at IS NULL AND ep.status <> 'cancelado';

-- 13b) Cancelamento manual defensivo (cobre falha de sync / título sem vínculo OMIE).
CREATE OR REPLACE FUNCTION public.fn_receber_cancelar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_rec erp_receber%ROWTYPE;
BEGIN
  SELECT * INTO v_rec FROM erp_receber WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_rec.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF v_rec.status = 'cancelado' THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_cancelado', true); END IF;

  UPDATE erp_receber SET status = 'cancelado',
    observacoes = COALESCE(observacoes || E'\n', '') || 'Cancelado: ' || COALESCE(NULLIF(btrim(p_motivo),''), 'sem motivo'),
    updated_at = now()
  WHERE id = p_id;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_rec.company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()),
      'erp_receber', p_id::text, 'CANCELOU_TITULO',
      jsonb_build_object('status', v_rec.status, 'valor', v_rec.valor),
      jsonb_build_object('status', 'cancelado', 'motivo', NULLIF(btrim(p_motivo),'')));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('sucesso', true, 'status', 'cancelado');
END; $function$;

REVOKE ALL ON FUNCTION public.fn_receber_cancelar(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_receber_cancelar(uuid, text) TO authenticated;
