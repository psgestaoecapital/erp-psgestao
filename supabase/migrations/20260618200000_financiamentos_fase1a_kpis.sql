-- financiamentos-fase1a · estrutura + KPIs

ALTER TABLE public.financiamentos
  ADD COLUMN IF NOT EXISTS saldo_total_parcelas numeric,
  ADD COLUMN IF NOT EXISTS parcela_futura numeric,
  ADD COLUMN IF NOT EXISTS taxa_anual numeric,
  ADD COLUMN IF NOT EXISTS data_origem date,
  ADD COLUMN IF NOT EXISTS observacao text,
  ADD COLUMN IF NOT EXISTS em_carencia boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.fn_financiamentos_kpis(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH f AS (
    SELECT * FROM public.financiamentos
    WHERE company_id = p_company_id
      AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
      AND lower(COALESCE(status, situacao, 'ativo')) NOT IN ('quitado','encerrado','cancelado','liquidado')
  )
  SELECT jsonb_build_object(
    'contratos_ativos',      (SELECT count(*) FROM f),
    'saldo_quitacao',        (SELECT COALESCE(sum(saldo_devedor),0) FROM f),
    'saldo_total_parcelas',  (SELECT COALESCE(sum(COALESCE(saldo_total_parcelas, saldo_devedor)),0) FROM f),
    'juros_embutidos',       (SELECT COALESCE(sum(COALESCE(saldo_total_parcelas, saldo_devedor) - saldo_devedor),0) FROM f),
    'compromisso_mensal',    (SELECT COALESCE(sum(valor_parcela),0) FROM f),
    'contratos_em_carencia', (SELECT count(*) FROM f WHERE em_carencia)
  );
$$;

REVOKE ALL ON FUNCTION public.fn_financiamentos_kpis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_financiamentos_kpis(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_financiamentos_kpis(uuid) IS
'financiamentos-fase1a · 6 KPIs do modulo Financiamento (Gestao Empresarial).';
