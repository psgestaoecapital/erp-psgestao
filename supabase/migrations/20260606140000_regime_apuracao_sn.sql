-- =============================================================
-- FIX-NFSE-REGIME-APURACAO-SN-v1
-- =============================================================
-- E0166: optante Simples ME/EPP exige campo regApTribSN.
-- Focus JSON: regime_tributario_simples_nacional
-- XML ADN: regApTribSN
-- Valores:
--   1 = Tributos federais E municipal apurados pelo SN
--   2 = Federais pelo SN + ISSQN fora do SN (lei municipal)
--   3 = Federais E municipal fora do SN (legis federal/municipal)
-- KGF Anexo III: ISS dentro do Simples -> valor 1
-- =============================================================

ALTER TABLE erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS regime_apuracao_sn smallint;

COMMENT ON COLUMN erp_fiscal_provider_config.regime_apuracao_sn IS
  'FIX-NFSE-REGIME-APURACAO-SN-v1 · 1=federais+municipal pelo SN, 2=federais SN + ISS fora, 3=ambos fora. Obrigatorio pra optante SN (opSimpNac 2 ou 3). NULL = nao informa.';

UPDATE erp_fiscal_provider_config
   SET regime_apuracao_sn = 1,
       atualizado_em = now()
 WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND provider = 'gov_nfse_nacional';
