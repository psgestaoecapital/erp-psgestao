-- =============================================================
-- FEAT-NFSE-NUMERACAO-v1
-- =============================================================
-- RPC atomica de numeracao NFS-e por empresa.
-- Fonte unica de verdade: erp_fiscal_provider_config
--   .serie_nfse_padrao + .proxima_numeracao_nfse
-- (a coluna legacy gov_nfse_proximo_numero_dps fica deprecada · so nao
-- e mais usada)
--
-- UPDATE...RETURNING serializa por linha (atomico) · evita race condition.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_proximo_numero_nfse(p_company_id uuid)
RETURNS TABLE(serie text, numero bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE erp_fiscal_provider_config c
     SET proxima_numeracao_nfse = c.proxima_numeracao_nfse + 1,
         atualizado_em = now()
   WHERE c.company_id = p_company_id
     AND c.provider = 'gov_nfse_nacional'
     AND c.ativo = true
  RETURNING
    c.serie_nfse_padrao::text AS serie,
    (c.proxima_numeracao_nfse - 1)::bigint AS numero;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_proximo_numero_nfse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_proximo_numero_nfse(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_proximo_numero_nfse IS
  'FEAT-NFSE-NUMERACAO-v1 · numeracao atomica de DPS de NFS-e Nacional. Cada call consome o proximo numero (nunca repete, mesmo se a Focus rejeitar).';
