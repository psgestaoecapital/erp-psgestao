#!/usr/bin/env bash
# Marca no banco de TESTES todas as migrations do repo como aplicadas (a estrutura já veio do dump).
# Versão = timestamp do NOME DO ARQUIVO (RD-52). Uso: TEST_DATABASE_URL=... scripts/banco-testes/ledger.sh
#
# 20/10 (gilberto-desenv): o recriar reconstrói o ledger a partir dos ARQUIVOS do repo, então o ledger tem de ficar
# EXATAMENTE igual ao conjunto de arquivos. Antes este script só INSERIA (ON CONFLICT DO NOTHING) e nunca removia, então
# um ÓRFÃO pré-existente (versão no ledger sem arquivo no repo — ex.: 20261019145520, carimbo apply-time) SOBREVIVIA ao
# recriar e o `supabase db push` seguinte abortava com "Remote migration versions not found in local migrations directory"
# (RD-52). Agora o ledger é reconciliado: insere as versões-de-arquivo e DELETA as versões órfãs (as que não têm arquivo
# no repo). Só o banco de TESTES (TEST_DATABASE_URL; os workflows barram a produção antes de chamar).
set -euo pipefail
: "${TEST_DATABASE_URL:?}"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
{
  echo "begin;"
  echo "create temp table _ledger_repo (version text primary key, name text) on commit drop;"
  for f in supabase/migrations/*.sql; do
    b=$(basename "$f" .sql); v=${b%%_*}; n=${b#*_}
    echo "insert into _ledger_repo(version,name) values ('$v','$n') on conflict (version) do nothing;"
  done
  # insere o que falta e remove os ÓRFÃOS (versões no ledger sem arquivo no repo) — ledger = conjunto de arquivos
  echo "insert into supabase_migrations.schema_migrations(version,name) select version,name from _ledger_repo on conflict (version) do nothing;"
  echo "delete from supabase_migrations.schema_migrations m where not exists (select 1 from _ledger_repo r where r.version = m.version);"
  echo "commit;"
} | psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q
psql "$TEST_DATABASE_URL" -Atc "select count(*) || ' versões no ledger de testes (reconciliado ao repo)' from supabase_migrations.schema_migrations"
