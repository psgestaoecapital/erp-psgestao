#!/usr/bin/env bash
# 24/10 (gilberto-desenv, msg ba5e5e8a): a aceitação da main (#800, #802) abortava em segundos na vaga 1 — o `db push`
# parava na 20261022203600_demo_corretora_agro_empresas com "companies_org_id_fkey: Key (org_id)=(c830f980-…) is not
# present in table organizations". As migrations das DEMOs (0001…0009) gravam a empresa na organização FIXA c830f980-…
# da produção, mas o banco de testes nasce do dump --schema public (sem dados) + semente.sql, que cria a organização
# com id aleatório. As DEMOs antigas entraram pelo ledger (marcadas, não rodadas); a primeira DEMO nova travou a vaga 1
# inteira (~80 migrations atrás da main desde 22/10).
# Aqui: garante no banco de TESTES a organização com esse id fixo (linha sintética, nenhum dado copiado da produção).
# Idempotente (rodar 2x dá o mesmo estado), nunca apaga nem altera linha existente. Roda ANTES de todo `db push` nas vagas.
# Uso: TEST_DATABASE_URL=<pooler de teste> scripts/banco-testes/garantir-org-demo.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado"; exit 1;; esac
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) echo "::error::TEST_DATABASE_URL precisa ser Session pooler"; exit 1;; esac
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
SET statement_timeout = '15s';
SET lock_timeout = '5s';
INSERT INTO public.organizations (id, name, slug)
VALUES ('c830f980-9be9-40c1-bb46-584cdc92dd65', 'PS Gestão DEMO (testes)', 'ps-gestao-demo-testes')
ON CONFLICT DO NOTHING;
SQL
n=$(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from public.organizations where id = 'c830f980-9be9-40c1-bb46-584cdc92dd65'")
[ "$n" = 1 ] || { echo "::error::organização das DEMOs (c830f980-…) não existe na vaga e não pôde ser criada (slug ocupado?)"; exit 1; }
echo "organização das DEMOs (c830f980-…) presente na vaga"
# 25/10: extensões no mesmo schema da produção (pg_trgm/unaccent em public) — este script já roda antes de todo db push
TEST_DATABASE_URL="$TEST_DATABASE_URL" "$(dirname "$0")/garantir-extensoes.sh"
