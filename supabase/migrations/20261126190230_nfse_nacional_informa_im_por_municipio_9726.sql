-- URGENTE — Chamado #9726 (Mecânica 163, Guarujá do Sul/SC): NFS-e Nacional rejeitada E0120.
--
-- CAUSA-RAIZ (RD-38, provado na produção 24/11): a IM do prestador na DPS é POR MUNICÍPIO.
--   • Guarujá do Sul (4206603) rejeita E0120: "IM do prestador não deve ser informada, pois não existem
--     informações complementares registradas no CNC NFS-e do município emissor";
--   • outros municípios (CNPJ 25277862000197, 53869330000184) rejeitam E0116 ("A IM DEVE ser informada")
--     quando a IM NÃO vai. Omitir a IM sempre regride os de E0116.
--
-- Solução por município, sem regressão: flag informa_im (default TRUE = comportamento atual = manda a IM,
-- então NENHUM município de E0116 regride). Só os marcados como false deixam de enviar a IM do prestador.
-- Aditiva e idempotente; erp_gov_nfse_municipios é tabela de referência (não é dado de cliente).
ALTER TABLE public.erp_gov_nfse_municipios
  ADD COLUMN IF NOT EXISTS informa_im boolean NOT NULL DEFAULT true;

-- Guarujá do Sul/SC (4206603): o município emissor do E0120 — não informar a IM do prestador na DPS.
UPDATE public.erp_gov_nfse_municipios SET informa_im = false WHERE codigo_ibge = '4206603';
