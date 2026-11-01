#!/usr/bin/env bash
# Marca no banco de TESTES todas as migrations do repo como aplicadas (a estrutura já veio do dump).
# Versão = timestamp do NOME DO ARQUIVO (RD-52). Uso: TEST_DATABASE_URL=... scripts/banco-testes/ledger.sh
#
# 20/10 (rodrigo-code): o Montar recriar NÃO resolvia órfã do ledger — o dump/restore do recriar mexe só no schema
# `public`, e o ledger vive em `supabase_migrations`, então órfãs (versão de PR não mergeada deixada por run cancelado)
# SOBREVIVIAM ao recriar e o próximo `db push` abortava. Agora o ledger do banco de TESTES fica EXATAMENTE os arquivos
# do repo: além de inserir os que faltam, REMOVE qualquer versão sem arquivo (órfã, acima ou abaixo da maior). Só o banco
# de testes; versão com arquivo nunca é tocada.
set -euo pipefail
: "${TEST_DATABASE_URL:?}"
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado"; exit 1;; esac
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
{
  echo "begin;"
  echo "create temp table _repo_led(version text) on commit drop;"
  for f in supabase/migrations/*.sql; do
    b=$(basename "$f" .sql); v=${b%%_*}; n=${b#*_}
    echo "insert into supabase_migrations.schema_migrations(version,name) values ('$v','$n') on conflict (version) do nothing;"
    echo "insert into _repo_led(version) values ('$v');"
  done
  # RD-52: o ledger de testes = EXATAMENTE os arquivos do repo. Remove órfãs (versão sem arquivo) para o recriar deixar
  # a vaga limpa e o db push seguinte convergir. As ~950 históricas têm arquivo → ficam.
  echo "delete from supabase_migrations.schema_migrations where version not in (select version from _repo_led);"
  echo "commit;"
} | psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q
psql "$TEST_DATABASE_URL" -Atc "select count(*) || ' versões no ledger de testes' from supabase_migrations.schema_migrations"
