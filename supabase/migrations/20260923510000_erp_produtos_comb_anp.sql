-- Grupo comb (combustível/lubrificante) no item da NF-e — campos ANP no produto.
-- Chamado Jordana/Gean (KGF/FC): 19 lubrificantes (NCM 2710) travados para faturar. O leiaute da NF-e
-- (NT 2016/002) exige, no item cujo NCM é de combustível/lubrificante, o grupo comb: cProdANP, descANP,
-- UFCons. Nenhum campo ANP existia no schema. cProdANP e descANP são POR PRODUTO (fixos, da tabela SIMP
-- da ANP — a Jordana preenche); UFCons é a UF do destinatário e sai na emissão (não é campo de cadastro).
--
-- Fonte oficial dos nomes de campo Focus (regra fiscal do CEO 23/09 · citar fonte, nunca web de
-- terceiros): https://campos.focusnfe.com.br/nfe/ItemNotaFiscalXML.html
--   cProdANP → combustivel_codigo_anp    (Integer[9])
--   descANP  → combustivel_descricao_anp (String[2-95])
--   UFCons   → combustivel_sigla_uf      (String[2]) — vem do destinatário na emissão
-- pGLP (combustivel_percentual_glp) só se aplica a GLP (código 210203001) — NÃO usado aqui.
--
-- Sem função nova (fora do gate check:fn-guards). RD-52 (arquivo = ledger; aplica no push à main).

ALTER TABLE public.erp_produtos
  ADD COLUMN IF NOT EXISTS combustivel_codigo_anp    integer,  -- cProdANP · código do produto na ANP (tabela SIMP)
  ADD COLUMN IF NOT EXISTS combustivel_descricao_anp text;     -- descANP · descrição do produto conforme a ANP

COMMENT ON COLUMN public.erp_produtos.combustivel_codigo_anp    IS 'cProdANP (NT 2016/002 · grupo comb): código do produto na tabela SIMP da ANP. Obrigatório no item de NF-e com NCM de combustível/lubrificante (NCM 2710...).';
COMMENT ON COLUMN public.erp_produtos.combustivel_descricao_anp IS 'descANP (NT 2016/002 · grupo comb): descrição do produto conforme a ANP. Obrigatória no item de NF-e com NCM de combustível/lubrificante (NCM 2710...).';
