-- nfe-recebidas-f1-distribuicao-dfe · listar empresas habilitadas
-- Usado pela edge nfe-distribuicao em modo=auto (cron).
-- service_role only · nao expor a usuarios autenticados.

CREATE OR REPLACE FUNCTION public.fn_nfe_distribuicao_listar_habilitadas()
RETURNS TABLE(
  company_id uuid,
  cnpj text,
  ambiente text,
  ultimo_nsu bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.company_id,
    c.cnpj,
    COALESCE(cfg.ambiente, 'homologacao') AS ambiente,
    d.ultimo_nsu
  FROM public.erp_nfe_distribuicao_controle d
  JOIN public.companies c ON c.id = d.company_id
  LEFT JOIN public.erp_fiscal_provider_config cfg
    ON cfg.company_id = d.company_id AND cfg.ativo = true
  WHERE d.habilitado = true
  ORDER BY d.ultima_consulta_em NULLS FIRST;
$$;

REVOKE ALL ON FUNCTION public.fn_nfe_distribuicao_listar_habilitadas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_nfe_distribuicao_listar_habilitadas() TO service_role;

COMMENT ON FUNCTION public.fn_nfe_distribuicao_listar_habilitadas() IS
'nfe-recebidas-f1-distribuicao-dfe · lista empresas com DF-e habilitado para o cron. service_role only.';
