-- PR 4.6 v3: orquestrador limpo, sem log que viola CHECK
CREATE OR REPLACE FUNCTION public.fn_truth_audit_executar_todas()
RETURNS TABLE (
  regra text,
  alertas integer,
  empresas integer,
  criticas integer,
  executado_em timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  r1 RECORD;
  r2 RECORD;
  r3 RECORD;
BEGIN
  SELECT * INTO r1 FROM fn_truth_audit_dre();
  RETURN QUERY SELECT 'dre_receita_bate_nfs'::text,
    r1.alertas_gerados, r1.empresas_auditadas, r1.divergencias_criticas, NOW();

  SELECT * INTO r2 FROM fn_truth_audit_dre_despesa();
  RETURN QUERY SELECT 'dre_despesas_bate_pagamentos'::text,
    r2.alertas_gerados, r2.empresas_auditadas, r2.divergencias_criticas, NOW();

  SELECT * INTO r3 FROM fn_truth_audit_compras();
  RETURN QUERY SELECT 'compras_nf_entrada_vinculada'::text,
    r3.alertas_gerados, r3.empresas_auditadas, r3.divergencias_criticas, NOW();
END $func$;

COMMENT ON FUNCTION public.fn_truth_audit_executar_todas() IS
'Truth Auditor orquestrador. Executa as 3 RPCs ativas: DRE receita, DRE despesa, Compras NF. PR 4.6 - 10/05/2026.';
