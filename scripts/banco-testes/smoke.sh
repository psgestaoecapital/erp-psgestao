#!/usr/bin/env bash
# INFRA-TESTES · Slice 1 (22/10) — smoke do portão de semente no PR. Roda no banco LOCAL EFÊMERO do runner (nunca produção
# nem vaga compartilhada), depois de migrations + semente.sql + usuário-robô. Cada vertical tem 1 asserção barata de leitura.
# Uso: DB_URL=postgresql://... BOT_EMAIL=... scripts/banco-testes/smoke.sh
set -uo pipefail
: "${DB_URL:?DB_URL ausente}"; : "${BOT_EMAIL:?BOT_EMAIL ausente}"
case "$DB_URL" in *horsymhsinqcimflrtjo*|*pooler.supabase.com*) echo "::error::smoke só roda no banco local efêmero — abortado"; exit 1;; esac

falhas=0
checa() { # checa "<nome>" "<sql que devolve um inteiro>" "<mínimo>"
  local nome="$1" sql="$2" min="$3" n
  n=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -At -c "SET statement_timeout='15s'; $sql" 2>&1 | tail -n1)
  if [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge "$min" ]; then echo "✓ $nome: $n (>= $min)"
  else echo "::error title=Smoke: $nome::esperado >= $min, veio '$n'"; falhas=$((falhas+1)); fi
}

checa "login do bot (auth.users)"            "select count(*) from auth.users where lower(email)=lower('$BOT_EMAIL')" 1
checa "bot vinculado às empresas DEMO"       "select count(*) from public.user_companies uc join auth.users u on u.id=uc.user_id where lower(u.email)=lower('$BOT_EMAIL')" 7
checa "vertical Oficina (DEMO)"              "select count(*) from public.companies where id='b0700000-0000-4000-a000-000000000001' and is_demo" 1
checa "vertical P&M (DEMO)"                  "select count(*) from public.companies where id='b0700000-0000-4000-a000-000000000002' and is_demo" 1
checa "vertical Revenda (DEMO)"              "select count(*) from public.companies where id='b0700000-0000-4000-a000-000000000003' and is_demo" 1
checa "vertical Gestão Empresarial (DEMO)"   "select count(*) from public.companies where id='b0700000-0000-4000-a000-000000000004' and is_demo" 1
checa "vertical Indústria/SST (DEMO)"        "select count(*) from public.companies where id='b0700000-0000-4000-a000-000000000005' and is_demo" 1
checa "vertical Construção/Hub (DEMO)"       "select count(*) from public.companies where id='b0700000-0000-4000-a000-000000000006' and is_demo" 1
checa "vertical Mecânica (DEMO)"             "select count(*) from public.companies where id='ded00000-0000-4000-a000-000000000001' and is_demo" 1

[ "$falhas" = 0 ] || { echo "::error::smoke: $falhas asserção(ões) falharam — a semente não monta sobre as migrations desta PR"; exit 1; }
echo "smoke ok"
