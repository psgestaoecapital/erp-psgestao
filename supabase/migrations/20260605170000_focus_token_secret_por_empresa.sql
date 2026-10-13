-- =============================================================
-- FEAT-NFSE-TOKEN-POR-EMPRESA-v1
-- =============================================================
-- Token Focus NFe agora resolvido por empresa via colunas
-- focus_token_secret_homolog / focus_token_secret_prod
-- em erp_fiscal_provider_config. Edges leem o NOME do secret na
-- config e buscam o valor com Deno.env (fallback pros nomes
-- legados FOCUS_NFE_TOKEN_HOMOLOGACAO/PRODUCAO).
--
-- Aplicado via MCP em 2026-06-05. KGF:
--   homolog: FOCUS_NFE_TOKEN_HOMOLOGACAO
--   prod:    FOCUS_NFE_TOKEN_PRODUCAO_KGF_AUTOCENTER_55081828000103
-- =============================================================

ALTER TABLE erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS focus_token_secret_homolog text,
  ADD COLUMN IF NOT EXISTS focus_token_secret_prod    text;

UPDATE erp_fiscal_provider_config
SET focus_token_secret_homolog = 'FOCUS_NFE_TOKEN_HOMOLOGACAO',
    focus_token_secret_prod    = 'FOCUS_NFE_TOKEN_PRODUCAO_KGF_AUTOCENTER_55081828000103'
WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b';
