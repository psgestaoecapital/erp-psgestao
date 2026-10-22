#!/usr/bin/env bash
# INFRA-TESTES slice 1 (Portão de semente no PR) — smoke do banco efêmero: semente + fn_demo_reset + 1 asserção por vertical.
# Roda contra o Postgres EFÊMERO do runner (nunca vaga nem produção). Falha alto se a semente quebrou.
# Uso: TEST_DATABASE_URL=postgresql://...@127.0.0.1:54322/postgres [BOT_EMAIL=...] scripts/banco-testes/smoke.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
case "$TEST_DATABASE_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "::error::smoke.sh só roda em Postgres local efêmero (127.0.0.1)"; exit 1;; esac
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::smoke.sh apontou para a PRODUÇÃO — abortado"; exit 1;; esac
BOT_EMAIL="${BOT_EMAIL:-robo-portao@testes.local}"
ROBO_ID=74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa
q() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -At "$@"; }
falhas=0
conf() { # conf <descrição> <sql que retorna count> — falha se count = 0
  local n; n=$(q -c "$2" | head -n1)
  if [ "${n:-0}" -gt 0 ]; then echo "✓ $1 ($n)"; else echo "::error title=Smoke da semente::$1 — vazio"; falhas=$((falhas+1)); fi
}

echo "== 1/3 usuário-robô (id fixo, direto no auth do banco efêmero) =="
q -c "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values ('$ROBO_ID','00000000-0000-0000-0000-000000000000','authenticated','authenticated','$BOT_EMAIL',crypt('portao-semente',gen_salt('bf')),now(),now(),now(),'{}','{}')
      on conflict (id) do nothing"

echo "== 2/3 semente.sql + fn_demo_reset nas 6 DEMOs =="
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -v bot_email="$BOT_EMAIL" -f scripts/banco-testes/semente.sql
for emp in b0700000-0000-4000-a000-000000000001 b0700000-0000-4000-a000-000000000002 b0700000-0000-4000-a000-000000000003 b0700000-0000-4000-a000-000000000004 b0700000-0000-4000-a000-000000000005 ded00000-0000-4000-a000-000000000001; do
  if q -c "select public.fn_demo_reset('$emp')" > /dev/null 2> "demo-reset-$emp.log"; then echo "✓ fn_demo_reset $emp"
  else echo "::error title=fn_demo_reset falhou ($emp)::$(tr '\n' ' ' < "demo-reset-$emp.log" | cut -c1-900)"; falhas=$((falhas+1)); fi
done

echo "== 3/3 asserções (1 por vertical + robô) =="
conf "robô vinculado às empresas DEMO" "select count(*) from public.user_companies where user_id = '$ROBO_ID'"
conf "empresas DEMO ativas (>= 6)" "select (count(*) >= 6)::int from public.companies where is_demo and is_active"
conf "plano_catalog povoado (revenda/gestão)" "select count(*) from public.plan_catalog"
conf "SST/Indústria: epi_catalogo povoado pelo fn_demo_reset" "select count(*) from public.epi_catalogo"
conf "Oficina: dado semeado na DEMO Oficina" "select count(*) from public.companies c where c.id = 'b0700000-0000-4000-a000-000000000001'"
conf "ledger das migrations == repo" "select (max(version) = '$(ls supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | tail -1)')::int from supabase_migrations.schema_migrations"
[ "$falhas" = 0 ] || { echo "::error::portão de semente: $falhas falha(s) — a semente/migration quebra o banco de testes"; exit 1; }
echo "### Portão de semente: OK ✓" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
