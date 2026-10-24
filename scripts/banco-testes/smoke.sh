#!/usr/bin/env bash
# INFRA-TESTES slice 1 — smoke da semente num banco EFÊMERO local (nunca a produção, nunca um banco compartilhado).
# Entrada: TEST_DATABASE_URL (127.0.0.1) já com TODAS as migrations aplicadas e os catálogos carregados. Aqui:
# usuário do robô (id fixo) → semente.sql → fn_demo_reset nas 6 DEMOs → 1 asserção por vertical. Falha = semente quebrada.
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
case "$TEST_DATABASE_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "::error::smoke.sh só roda em banco local efêmero"; exit 1;; esac
PSQL="${PSQL:-psql}"
BOT_EMAIL="${PLAYWRIGHT_USER_EMAIL:-robo-smoke@testes.local}"
ROBO_ID=74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa
B=b0700000-0000-4000-a000-00000000000
q() { "$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }

echo "== 1/4 usuário do robô (id fixo) =="
q "insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
   values ('$ROBO_ID','00000000-0000-0000-0000-000000000000','authenticated','authenticated','$BOT_EMAIL',now(),now(),now())
   on conflict (id) do nothing"
[ "$(q "select count(*) from auth.users where id='$ROBO_ID'")" = 1 ] || { echo "::error::robô não criado no auth.users"; exit 1; }

echo "== 2/4 semente.sql =="
"$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -v bot_email="$BOT_EMAIL" -q -f scripts/banco-testes/semente.sql

echo "== 3/4 fn_demo_reset nas DEMOs =="
falhou=0
for emp in ${B}1 ${B}2 ${B}3 ${B}4 ${B}5 ded00000-0000-4000-a000-000000000001; do
  if ! "$PSQL" "$TEST_DATABASE_URL" -v VERBOSITY=terse -q -c "select public.fn_demo_reset('$emp')" > /dev/null 2> "$RUNNER_TEMP/reset-$emp.log"; then
    echo "::error title=fn_demo_reset falhou ($emp)::$(tr '\n' ' ' < "$RUNNER_TEMP/reset-$emp.log" | cut -c1-600)"
    falhou=1
  fi
done
[ "$falhou" = 0 ] || { echo "::error::semente quebrada: fn_demo_reset falhou"; exit 1; }

echo "== 4/4 asserções por vertical (login do robô + dado mínimo) =="
falta=0
chk() { n=$(q "$2" 2>/dev/null || echo erro); echo "$1: $n"; case "$n" in erro|0|"") echo "::error::smoke: $1 vazio"; falta=1;; esac; }
chk robo_user_companies   "select count(*) from public.user_companies where user_id='$ROBO_ID' and role='adm'"
chk demos_ativas          "select count(*) from public.companies where is_demo and id::text like 'b0700000-%'"
chk oficina_os            "select count(*) from public.erp_os where company_id='${B}1'::uuid"
chk pm_empresa            "select count(*) from public.companies where id='${B}2'::uuid"
chk revenda_empresa       "select count(*) from public.companies where id='${B}3'::uuid"
chk ge_plano_contas       "select count(*) from public.erp_plano_contas where company_id='${B}4'::uuid"
chk sst_epi_catalogo      "select count(*) from public.epi_catalogo"
chk plano_ativo_por_demo  "select count(*) from public.tenant_subscriptions where status='active' and company_id::text like 'b0700000-%'"
[ "$falta" = 0 ] || exit 1
echo "### Smoke da semente: ok (migrations do zero + semente + fn_demo_reset + 1 asserção por vertical)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
