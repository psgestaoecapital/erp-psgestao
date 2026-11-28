-- Cadastro de fornecedores · busca por documento acha 100% (dígitos normalizados)
--
-- PROBLEMA (RD-38, provado na base de produção em 2026-11-27):
--   erp_fornecedores guarda o documento em duas colunas (cnpj_cpf, cpf_cnpj), e
--   3.053 de 4.601 fornecedores ATIVOS com documento (66%) gravam o valor FORMATADO
--   (com pontuação). A busca da lista (PessoasList) monta `digitos = termo.replace(/\D/g,'')`
--   e, no ramo de fornecedor, batia nas colunas CRUAS — o PostgREST não remove a pontuação
--   do lado armazenado, então quem digita só números NÃO achava esses 3.053 fornecedores.
--   O pré-check de duplicidade do PessoaForm (fornecedor) tinha o mesmo furo: o `.eq` por
--   dígitos contra a coluna CRUA não casa o documento guardado com pontuação, então o aviso
--   amigável "já existe, abrir?" não disparava (só o gatilho do banco barrava no save).
--
-- CORREÇÃO (ADITIVA, núcleo cadastros — espelha o que a #5848 já fez para erp_clientes):
--   coluna GERADA `documento_digitos` (só os dígitos, derivada das duas colunas, mesma
--   expressão IMMUTABLE usada em erp_clientes) + índice trigram parcial (ativo) para a busca
--   por substring. A busca da lista e o pré-check de duplicidade passam a bater nessa coluna
--   → acham/casam 100%. NÃO altera nem apaga dado de cliente: a coluna é COMPUTADA; as colunas
--   de origem ficam intactas. Idempotente (IF NOT EXISTS). A RLS/policies da tabela não mudam
--   (coluna derivada herda a proteção existente da erp_fornecedores).

-- Coluna canônica de dígitos (STORED, expressão IMMUTABLE idêntica à de erp_clientes).
ALTER TABLE public.erp_fornecedores
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

COMMENT ON COLUMN public.erp_fornecedores.documento_digitos IS
  'Dígitos do documento (CPF/CNPJ) derivados de cpf_cnpj/cnpj_cpf — fonte única para busca por documento. Coluna GERADA (STORED), não editável.';

-- Índice trigram parcial para a busca por substring de dígitos (só registros ativos,
-- que é o universo da listagem). pg_trgm já está habilitado nesta base.
CREATE INDEX IF NOT EXISTS idx_erp_fornecedores_documento_digitos_trgm
  ON public.erp_fornecedores USING gin (documento_digitos gin_trgm_ops)
  WHERE ativo;
