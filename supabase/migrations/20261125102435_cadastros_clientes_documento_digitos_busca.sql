-- Cadastro de clientes · busca por documento acha 100% (dígitos normalizados)
--
-- PROBLEMA (RD-38, provado na base de produção em 2026-11-22):
--   erp_clientes guarda o documento em duas colunas (cnpj_cpf text, cpf_cnpj varchar),
--   e 9.350 de 18.619 clientes com documento (50,2%) gravam o valor FORMATADO (com
--   pontuação). A busca da lista (PessoasList) monta `digitos = termo.replace(/\D/g,'')`
--   e faz `.ilike.*digitos*` contra a coluna CRUA — o PostgREST não remove a pontuação do
--   lado armazenado, então quem digita só números NÃO acha esses 9.350 clientes.
--
-- CORREÇÃO (aditiva, núcleo cadastros, dado de cliente):
--   coluna GERADA `documento_digitos` (só os dígitos, derivada das duas colunas, mesma
--   lógica IMMUTABLE de fn_clientes_documento_digitos) + índice trigram parcial (ativo)
--   para a busca por substring. A busca da lista passa a bater nessa coluna → acha 100%.
--   Não altera nem apaga dado de cliente: a coluna é COMPUTADA; as colunas de origem ficam
--   intactas. Idempotente (IF NOT EXISTS).

-- Coluna canônica de dígitos (STORED, expressão IMMUTABLE espelhando fn_clientes_documento_digitos).
ALTER TABLE public.erp_clientes
  ADD COLUMN IF NOT EXISTS documento_digitos text
  GENERATED ALWAYS AS (
    nullif(
      regexp_replace(
        coalesce(nullif(btrim(cpf_cnpj), ''), nullif(btrim(cnpj_cpf), ''), ''),
        '\D', '', 'g'
      ),
      ''
    )
  ) STORED;

COMMENT ON COLUMN public.erp_clientes.documento_digitos IS
  'Dígitos do documento (CPF/CNPJ) derivados de cpf_cnpj/cnpj_cpf — fonte única para busca por documento. Coluna GERADA (STORED), não editável.';

-- Índice trigram parcial para a busca por substring de dígitos (só registros ativos,
-- que é o universo da listagem). pg_trgm já está habilitado nesta base.
CREATE INDEX IF NOT EXISTS idx_erp_clientes_documento_digitos_trgm
  ON public.erp_clientes USING gin (documento_digitos gin_trgm_ops)
  WHERE ativo;
