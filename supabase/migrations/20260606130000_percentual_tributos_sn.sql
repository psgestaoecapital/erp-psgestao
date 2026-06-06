-- =============================================================
-- FIX-NFSE-TRIBUTOS-SIMPLES-v1
-- =============================================================
-- Causa POST 422 "Element trib: Missing child element(s).
-- Expected (tribFed, totTrib)": gov-nfse-emitir nao enviava nenhum
-- bloco de tributos (totTrib eh obrigatorio no schema ADN).
--
-- Para Simples Nacional, o caminho correto eh
-- percentual_total_tributos_simples_nacional (= pTotTribSN no XML).
-- A Focus auto-preenche indTotTrib=1 + totTrib quando esse campo vem.
--
-- Parametrizavel por empresa (cada uma declara sua aliquota Simples
-- no momento da ativacao · sem default global).
--
-- KGF: 6.00 (Anexo III Simples Nacional servicos · faixa inicial)
-- =============================================================

ALTER TABLE erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS percentual_total_tributos_sn numeric(5,2);

COMMENT ON COLUMN erp_fiscal_provider_config.percentual_total_tributos_sn IS
  'FIX-NFSE-TRIBUTOS-SIMPLES-v1 · percentual aproximado dos tributos da aliquota Simples (Lei 12.741). Vai no payload Focus como percentual_total_tributos_simples_nacional / XML pTotTribSN. NULL = nao informa.';

UPDATE erp_fiscal_provider_config
   SET percentual_total_tributos_sn = 6.00,
       atualizado_em = now()
 WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND provider = 'gov_nfse_nacional';
