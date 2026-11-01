#!/usr/bin/env bash
# Causa 2 (CEO 21/10) — banco de testes DETERMINÍSTICO: nasce das migrations do zero, não do dump da produção.
#
# O montar atual copia a ESTRUTURA da produção e CARIMBA o ledger (scripts/banco-testes/ledger.sh) sem aplicar as
# migrations. Daí nascem o drift, os órfãos no ledger e o "vaga atrás da main" que travam a esteira. Aqui, ao
# contrário, aplicamos TODAS as migrations do repo com `supabase db push --include-all` num public limpo: o schema e
# o ledger passam a bater com a main POR CONSTRUÇÃO — a classe inteira de causas de drift desaparece.
#
# Opt-in: só roda no montar-banco-testes com do_zero=true. A semente (catálogos + DEMO) é a MESMA do montar atual,
# aplicada depois pelos passos de sempre. Este script faz só a parte determinística (schema + ledger).
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
t0=$(date +%s)

# travas de segurança (nunca a produção; sempre o Session pooler)
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::montar-do-zero aponta para a PRODUÇÃO — abortado"; exit 1;; esac
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) echo "::error::TEST_DATABASE_URL precisa ser Session pooler (*.pooler.supabase.com)"; exit 1;; esac

echo "== 1/4 limpa o schema public (em lotes) =="
scripts/banco-testes/limpar-public.sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "create schema if not exists public; grant usage on schema public to postgres, anon, authenticated, service_role; alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role; alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;"

echo "== 2/4 extensões que as migrations assumem já existentes (o db push não as cria) =="
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS citext;" || echo "::warning::alguma extensão não pôde ser criada — o db push dirá se faltou"

echo "== 3/4 aplica TODAS as migrations do repo, do zero (schema + ledger juntos) =="
supabase db push --include-all --db-url "$TEST_DATABASE_URL"

echo "== 4/4 prova anti-drift: ledger == última migration do repo =="
repo_max=$(ls supabase/migrations/*.sql 2>/dev/null | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | tail -1)
led_max=$(psql "$TEST_DATABASE_URL" -tAc "select max(version) from supabase_migrations.schema_migrations" | tr -d '[:space:]')
echo "ledger_max=$led_max  repo_max=$repo_max"
if [ "$led_max" != "$repo_max" ]; then
  echo "::error::montar-do-zero: ledger ($led_max) != última migration do repo ($repo_max) — a montagem do zero não bateu"
  exit 1
fi
echo "### Montar do ZERO (determinístico): $(( $(date +%s) - t0 )) s · ledger=$led_max == repo=$repo_max — sem drift ✓" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
