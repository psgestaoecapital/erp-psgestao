-- =============================================================
-- FIX-NFSE-OPCAO-SIMPLES-v1
-- =============================================================
-- Causa E0160 KGF: gov-nfse-emitir enviava codigo_opcao_simples_nacional=1
-- HARDCODED. No padrao nacional ADN:
--   1 = Nao optante
--   2 = Optante MEI
--   3 = Optante ME/EPP
-- KGF eh ME/EPP optante Simples (cadastro RFB desde 20/05/2025) -> 3.
--
-- Cada empresa declara a sua opcao na ativacao · sem default global.
-- =============================================================

ALTER TABLE erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS opcao_simples_nacional smallint;

COMMENT ON COLUMN erp_fiscal_provider_config.opcao_simples_nacional IS
  'FIX-NFSE-OPCAO-SIMPLES-v1 · padrao ADN: 1=Nao optante, 2=Optante MEI, 3=Optante ME/EPP. NULL = nao declarado pra esta empresa.';

UPDATE erp_fiscal_provider_config
   SET opcao_simples_nacional = 3,
       atualizado_em = now()
 WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND provider = 'gov_nfse_nacional';
