-- Hub · ONDA S-MED (tela 320) — item 1 da spec: papel, contraparte e contrato na medição
-- Aditivo (ADD COLUMN IF NOT EXISTS). A tabela projetos_obra_medicao já existe e é pequena.
-- papel define o lado do título que a medição gera quando o fluxo chega ao financeiro (fatia futura):
--   'contratante' = meço o meu empreiteiro        -> a PAGAR  (contraparte = fornecedor)
--   'contratado'  = sou medido pelo meu cliente    -> a RECEBER (contraparte = cliente)
--   'fiscal'      = escritório fiscaliza            -> SEM título
-- Sem FK dura nesta fatia: a contraparte é validada pela RPC de criação/edição da medição
-- contra erp_fornecedores / erp_clientes da empresa (RLS por company_id).

ALTER TABLE public.projetos_obra_medicao
  ADD COLUMN IF NOT EXISTS papel         text,
  ADD COLUMN IF NOT EXISTS fornecedor_id uuid,
  ADD COLUMN IF NOT EXISTS cliente_id    uuid,
  ADD COLUMN IF NOT EXISTS contrato_ref  text;

-- Domínio de papel (idempotente). A tabela é pequena; a validação do CHECK é barata.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projetos_obra_medicao_papel_chk') THEN
    ALTER TABLE public.projetos_obra_medicao
      ADD CONSTRAINT projetos_obra_medicao_papel_chk
      CHECK (papel IS NULL OR papel IN ('contratante','contratado','fiscal'));
  END IF;
END $$;

COMMENT ON COLUMN public.projetos_obra_medicao.papel IS
  'Lado da medição: contratante (a pagar · contraparte=fornecedor), contratado (a receber · contraparte=cliente), fiscal (sem título).';
COMMENT ON COLUMN public.projetos_obra_medicao.fornecedor_id IS 'Contraparte quando papel=contratante (erp_fornecedores).';
COMMENT ON COLUMN public.projetos_obra_medicao.cliente_id    IS 'Contraparte quando papel=contratado (erp_clientes).';
COMMENT ON COLUMN public.projetos_obra_medicao.contrato_ref  IS 'Referência do contrato da medição (número/identificação).';
