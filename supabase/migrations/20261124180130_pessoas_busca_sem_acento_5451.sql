-- Chamado #5451 (cadastros/clientes): "ao pesquisar o cliente, se nao botar o acento
-- ou nao escrever 100% o cadastro, ele nao puxa". Causa: a busca usa ILIKE, que ignora
-- maiusculas mas NAO ignora acento -> "Romario" nunca acha "Romario" (com acento) no banco.
--
-- Correcao ADITIVA e idempotente: coluna gerada `busca_norm` (nome_fantasia + razao_social,
-- minusculo e SEM acento) nas duas tabelas que a lista de Pessoas usa (clientes e fornecedores),
-- com indice trigram. O front normaliza o termo digitado (tira acento, minusculo) e filtra essa
-- coluna. Nenhuma coluna existente muda; RLS das tabelas segue valendo (coluna herda a politica).
--
-- Seguranca: so DDL aditiva (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / funcao nova).
-- Nenhum UPDATE/DELETE em dado de cliente. A coluna gerada e preenchida pelo proprio Postgres.

create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- Wrapper IMMUTABLE exigido por coluna GENERATED (a forma 2-arg de unaccent fixa o dicionario
-- 'public.unaccent', o padrao recomendado para normalizacao estavel/indexavel).
create or replace function public.fn_texto_busca_norm(p text)
  returns text
  language sql
  immutable
  parallel safe
as $$ select lower(unaccent('public.unaccent', coalesce(p, ''))) $$;

comment on function public.fn_texto_busca_norm(text) is
  'Normaliza texto para busca: minusculo e sem acento (chamado #5451). Immutable para coluna gerada/indice.';

-- Clientes
alter table public.erp_clientes
  add column if not exists busca_norm text
  generated always as (
    public.fn_texto_busca_norm(coalesce(nome_fantasia, '') || ' ' || coalesce(razao_social, ''))
  ) stored;

create index if not exists idx_erp_clientes_busca_norm_trgm
  on public.erp_clientes using gin (busca_norm gin_trgm_ops);

-- Fornecedores (a lista de Pessoas e compartilhada entre clientes e fornecedores)
alter table public.erp_fornecedores
  add column if not exists busca_norm text
  generated always as (
    public.fn_texto_busca_norm(coalesce(nome_fantasia, '') || ' ' || coalesce(razao_social, ''))
  ) stored;

create index if not exists idx_erp_fornecedores_busca_norm_trgm
  on public.erp_fornecedores using gin (busca_norm gin_trgm_ops);
