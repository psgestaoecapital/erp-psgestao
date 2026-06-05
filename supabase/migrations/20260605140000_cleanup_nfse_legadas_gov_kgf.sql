-- =============================================================
-- FEAT-NFSE-CONSULTA-v1 · Limpeza KGF
-- =============================================================
-- Apaga registros legados do caminho gov.br antigo (provider_reference
-- comeca com 'gov-'). Sao test data da fase mTLS+XAdES (PRs #233-#239)
-- antes do pivot pra Focus NFe (PR #240).
--
-- Inclui DPS associados (FK erp_gov_nfse_dps.nfse_emitida_id).
--
-- REGRA: APENAS company_id KGF (a462e13f-0f51-4c54-abe8-4474b591633b).
--
-- Aplicado via MCP em 2026-06-05: 4 DPS + 4 NFSes removidas.
-- =============================================================

DELETE FROM erp_gov_nfse_dps
WHERE nfse_emitida_id IN (
  SELECT id FROM erp_nfse_emitidas
  WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
    AND provider_reference LIKE 'gov-%'
);

DELETE FROM erp_nfse_emitidas
WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
  AND provider_reference LIKE 'gov-%';
