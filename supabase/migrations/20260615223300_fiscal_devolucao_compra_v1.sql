-- =============================================================
-- fiscal-devolucao-compra-v1
-- =============================================================
-- + coluna chave_referenciada em erp_nfe_emitidas: chave 44 digitos
-- da NF-e original referenciada em devolucao/ajuste.
-- + index parcial para buscar devolucoes de uma compra especifica.
--
-- Frontend: nova tela /dashboard/fiscal/nfe/devolucao usa este campo.
-- Provider FocusNFeProvider.emitirNFe agora coloca a chave em
-- nfes_referenciadas[] no payload Focus (grupo NFref).
--
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

ALTER TABLE public.erp_nfe_emitidas
  ADD COLUMN IF NOT EXISTS chave_referenciada text;

CREATE INDEX IF NOT EXISTS idx_erp_nfe_emitidas_chave_ref
  ON public.erp_nfe_emitidas(chave_referenciada)
  WHERE chave_referenciada IS NOT NULL;
