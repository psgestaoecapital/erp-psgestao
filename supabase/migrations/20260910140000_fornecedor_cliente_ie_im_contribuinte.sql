-- ============================================================
-- Fornecedor/Cliente · Inscrição Municipal + indicador de Contribuinte ICMS + backfill de IE
-- (contexto: devolução da Impave rejeitada por "IE do destinatário não informada")
-- ============================================================
-- A IE já existe nas duas tabelas. Faltavam:
--   (a) Inscrição Municipal;
--   (b) o INDICADOR de contribuinte de ICMS (indIEDest da SEFAZ):
--       1 = contribuinte (tem IE) · 2 = isento de inscrição · 9 = não contribuinte.
-- "isento" é uma ESCOLHA declarada; "sem IE" é AUSÊNCIA de dado — e hoje o sistema não
-- distingue, o que gerou a confusão. Guardamos como texto legível + CHECK.
-- Vale para fornecedores E clientes: ambos são destinatários de NF-e (devolução e venda).

ALTER TABLE public.erp_fornecedores
  ADD COLUMN IF NOT EXISTS inscricao_municipal varchar,
  ADD COLUMN IF NOT EXISTS contribuinte_icms text;
ALTER TABLE public.erp_clientes
  ADD COLUMN IF NOT EXISTS inscricao_municipal varchar,
  ADD COLUMN IF NOT EXISTS contribuinte_icms text;

COMMENT ON COLUMN public.erp_fornecedores.contribuinte_icms IS
  'Indicador de contribuinte ICMS (indIEDest NF-e): contribuinte(1)/isento(2)/nao_contribuinte(9). NULL = não declarado.';
COMMENT ON COLUMN public.erp_clientes.contribuinte_icms IS
  'Indicador de contribuinte ICMS (indIEDest NF-e): contribuinte(1)/isento(2)/nao_contribuinte(9). NULL = não declarado.';

ALTER TABLE public.erp_fornecedores DROP CONSTRAINT IF EXISTS erp_fornecedores_contribuinte_icms_chk;
ALTER TABLE public.erp_fornecedores ADD CONSTRAINT erp_fornecedores_contribuinte_icms_chk
  CHECK (contribuinte_icms IS NULL OR contribuinte_icms IN ('contribuinte','isento','nao_contribuinte'));
ALTER TABLE public.erp_clientes DROP CONSTRAINT IF EXISTS erp_clientes_contribuinte_icms_chk;
ALTER TABLE public.erp_clientes ADD CONSTRAINT erp_clientes_contribuinte_icms_chk
  CHECK (contribuinte_icms IS NULL OR contribuinte_icms IN ('contribuinte','isento','nao_contribuinte'));

-- ------------------------------------------------------------
-- Backfill (parte 2): recupera a IE do emitente da nota de compra pros fornecedores SEM IE
-- cujo CNPJ bate com uma nota recebida que trouxe emitente_ie. Auto-cura, só os recuperáveis.
-- RD-38: 2 provados hoje (TOY TINTAS, IRMÃOS DE MARCO); a Impave já foi corrigida na mão.
-- DISTINCT ON pega a IE da nota mais recente por (empresa, CNPJ) — evita ambiguidade se houver
-- mais de uma nota. Só toca quem está sem IE (não sobrescreve dado existente).
-- ------------------------------------------------------------
WITH notas AS (
  SELECT DISTINCT ON (company_id, doc) company_id, doc, emitente_ie
  FROM (
    SELECT company_id, regexp_replace(emitente_cnpj,'\D','','g') AS doc, emitente_ie, created_at
    FROM erp_nfe_recebidas WHERE COALESCE(btrim(emitente_ie),'') <> ''
  ) x
  ORDER BY company_id, doc, created_at DESC
)
UPDATE erp_fornecedores f
   SET ie = n.emitente_ie, updated_at = now()
  FROM notas n
 WHERE COALESCE(btrim(f.ie),'') = ''
   AND n.company_id = f.company_id
   AND length(regexp_replace(COALESCE(f.cnpj_cpf, f.cpf_cnpj, ''),'\D','','g')) = 14
   AND n.doc = regexp_replace(COALESCE(f.cnpj_cpf, f.cpf_cnpj, ''),'\D','','g');
