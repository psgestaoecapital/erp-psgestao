-- CST 500 (ICMS cobrado anteriormente por ST) — campos de ST retido no produto.
-- Chamado Jordana: empresa travada para vender qualquer produto com CST 500 (21 produtos na KGF).
-- O leiaute da NF-e (NT 2018.005) exige, no item CST 60/500, o grupo ST retido: vBCSTRet, pST,
-- vICMSSubstituto, vICMSSTRet. Nenhum existia no schema. Guardados POR UNIDADE no produto — os VALORES
-- escalam pela quantidade na emissão; a alíquota (pst) é percentual e não multiplica.
--
-- Preenchimento hoje: manual na ficha do produto (bloco Fiscal). PR B: extrair do XML de compra.
-- Sem função nova (fora do gate check:fn-guards). RD-52 (arquivo = ledger; aplica no push à main).

ALTER TABLE public.erp_produtos
  ADD COLUMN IF NOT EXISTS vbcst_ret        numeric,  -- vBCSTRet · base de cálculo do ICMS ST retido (por unidade)
  ADD COLUMN IF NOT EXISTS pst              numeric,  -- pST · alíquota suportada pelo consumidor final (%) — NÃO multiplica por qtd
  ADD COLUMN IF NOT EXISTS vicms_substituto numeric,  -- vICMSSubstituto · ICMS próprio do substituto (por unidade)
  ADD COLUMN IF NOT EXISTS vicms_st_ret     numeric;  -- vICMSSTRet · ICMS ST retido (por unidade)

COMMENT ON COLUMN public.erp_produtos.vbcst_ret        IS 'vBCSTRet (NT 2018.005): base de cálculo do ICMS ST retido, por unidade. Escala pela quantidade na emissão.';
COMMENT ON COLUMN public.erp_produtos.pst              IS 'pST (NT 2018.005): alíquota suportada pelo consumidor final (%). Percentual — não multiplica por quantidade.';
COMMENT ON COLUMN public.erp_produtos.vicms_substituto IS 'vICMSSubstituto (NT 2018.005): ICMS próprio do substituto, por unidade. Escala pela quantidade na emissão.';
COMMENT ON COLUMN public.erp_produtos.vicms_st_ret     IS 'vICMSSTRet (NT 2018.005): ICMS ST retido, por unidade. Escala pela quantidade na emissão.';
