-- PDCA GE · /dashboard/cadastros/produtos (auditor_pdca_2, aud8 95/95) — gap #6 (RD-98 pilar 4)
-- Exclusão de produto hoje é lógica (ativo=false) mas NÃO rastreável: erp_produtos não guarda
-- quem/quando excluiu e o caminho da API não escrevia em audit_log_global.
-- Esta migration é a FUNDAÇÃO (aditiva): só acrescenta colunas nullable. O caminho de exclusão
-- (DELETE em src/app/api/cadastros/produtos/route.ts) passa a gravar deleted_at/deleted_by + audit.
--
-- Aditiva e idempotente. Não altera RLS, grants, nem dado de cliente. Núcleo (erp_produtos).
-- Code: code-desenvolvedor-3

ALTER TABLE public.erp_produtos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

COMMENT ON COLUMN public.erp_produtos.deleted_at IS 'Quando o produto foi excluído logicamente (ativo=false). NULL = ativo/nunca excluído. RD-98 p4.';
COMMENT ON COLUMN public.erp_produtos.deleted_by IS 'auth.uid() de quem excluiu logicamente o produto. RD-98 p4 (rastreabilidade).';
