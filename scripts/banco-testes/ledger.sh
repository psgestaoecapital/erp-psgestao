#!/usr/bin/env bash
# Marca no banco de TESTES todas as migrations do repo como aplicadas (a estrutura já veio do dump).
# Versão = timestamp do NOME DO ARQUIVO (RD-52). Uso: TEST_DATABASE_URL=... scripts/banco-testes/ledger.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?}"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
{
  echo "begin;"
  for f in supabase/migrations/*.sql; do
    b=$(basename "$f" .sql); v=${b%%_*}; n=${b#*_}
    echo "insert into supabase_migrations.schema_migrations(version,name) values ('$v','$n') on conflict (version) do nothing;"
  done
  echo "commit;"
} | psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q
psql "$TEST_DATABASE_URL" -Atc "select count(*) || ' versões no ledger de testes' from supabase_migrations.schema_migrations"
