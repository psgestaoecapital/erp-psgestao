#!/usr/bin/env bash
# Onda INFRA-TESTES · Slice 1 (gilberto-desenv, 20/10): smoke do banco LOCAL do portão de semente da PR
# (portao-semente-pr.yml). Banco efêmero montado SÓ das migrations do repo (sem produção). Confere: schema (migrations
# aplicaram), semente.sql idempotente, login do bot e 1 asserção por vertical (empresa DEMO + plano). fn_demo_reset roda
# em modo informativo (::warning) até o Slice 3 (catálogos versionados): sem catálogo copiado da produção ele falha por
# plan_catalog vazio — isso é conhecido, não é regressão da PR. SMOKE_ESTRITO=1 transforma o aviso em falha.
set -euo pipefail
: "${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL ausente}" "${PLAYWRIGHT_USER_EMAIL:?e-mail do bot ausente}"
PROD_REF=horsymhsinqcimflrtjo
case "$LOCAL_DATABASE_URL" in *127.0.0.1*|*localhost*) ;; *) echo "::error::smoke só roda em banco LOCAL"; exit 1;; esac
case "$LOCAL_DATABASE_URL" in *"$PROD_REF"*) echo "::error::URL aponta para a PRODUÇÃO — abortado"; exit 1;; esac
psqlx() { psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -At "$@"; }
falhou=0
falha() { echo "::error title=Portão de semente::$*"; falhou=1; }

n=$(psqlx -c "select count(*) from supabase_migrations.schema_migrations")
echo "migrations aplicadas no banco local: $n"
[ "$n" -gt 0 ] || falha "nenhuma migration aplicada"

# semente.sql duas vezes (idempotência)
for i in 1 2; do
  psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -q -v bot_email="$PLAYWRIGHT_USER_EMAIL" -f scripts/banco-testes/semente.sql >/dev/null \
    || falha "semente.sql falhou na execução $i (schema novo quebrou a semente)"
done

# 1 asserção por vertical: empresa DEMO existe, ativa e com o bot vinculado
while IFS='|' read -r vertical emp; do
  ok=$(psqlx -c "select count(*) from public.companies c join public.user_companies uc on uc.company_id=c.id join auth.users u on u.id=uc.user_id where c.id='$emp' and c.is_demo and u.email='$PLAYWRIGHT_USER_EMAIL'" 2>/dev/null || echo erro)
  if [ "$ok" = 1 ]; then echo "✓ $vertical"; else falha "vertical $vertical: empresa DEMO $emp sem vínculo com o bot (resultado: $ok)"; fi
done <<'L'
oficina|b0700000-0000-4000-a000-000000000001
pm|b0700000-0000-4000-a000-000000000002
revenda|b0700000-0000-4000-a000-000000000003
gestao|b0700000-0000-4000-a000-000000000004
industria_sst|b0700000-0000-4000-a000-000000000005
mecanica|ded00000-0000-4000-a000-000000000001
L

# fn_demo_reset: informativo até o Slice 3
for emp in b0700000-0000-4000-a000-000000000001 b0700000-0000-4000-a000-000000000002 b0700000-0000-4000-a000-000000000003 b0700000-0000-4000-a000-000000000004 b0700000-0000-4000-a000-000000000005 ded00000-0000-4000-a000-000000000001; do
  if ! err=$(psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -c "select public.fn_demo_reset('$emp')" 2>&1 >/dev/null); then
    msg="fn_demo_reset($emp) falhou: $(printf '%s' "$err" | tr '\n' ' ' | cut -c1-300)"
    if [ "${SMOKE_ESTRITO:-0}" = 1 ]; then falha "$msg"; else echo "::warning title=fn_demo_reset (informativo)::$msg"; fi
  fi
done

[ "$falhou" = 0 ] || exit 1
echo "Portão de semente: ok"
