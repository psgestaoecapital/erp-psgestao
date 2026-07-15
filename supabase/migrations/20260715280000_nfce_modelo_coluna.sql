-- NFC-e (modelo 65) · Parte 1 · fundação — distinguir NF-e (55) de NFC-e (65)
-- ============================================================================
-- A KGF (mecânica) vende peça no balcão pro consumidor final → precisa NFC-e (mod.65),
-- que hoje não existe. erp_nfe_emitidas guarda hoje só NF-e (mod.55) sem coluna que
-- distinga. Adiciona 'modelo' pra o mesmo registro servir aos dois (55 e 65).
-- O CSC vive no Focus (config da empresa lá) + no nosso Vault (secret 'csc_sc',
-- nunca em coluna plaintext) — este passo é só a distinção de modelo.
-- ============================================================================
ALTER TABLE public.erp_nfe_emitidas
  ADD COLUMN IF NOT EXISTS modelo text NOT NULL DEFAULT '55';

COMMENT ON COLUMN public.erp_nfe_emitidas.modelo IS
  'Modelo do documento fiscal: 55 = NF-e (produto/B2B) · 65 = NFC-e (consumidor final/balcão). Default 55 (o que já existia).';
