#!/usr/bin/env bash
# Echoa a Connection string (Session pooler) da PRODUÇÃO — SÓ PARA LEITURA. A restauração da vaga (reconciliar-vaga.sh)
# lê com ela a definição aprovada de funções/views (pg_get_functiondef/viewdef) e a assinatura do schema. NUNCA escreve
# na produção (o reconciliar-vaga.sh só manda SELECT a esta URL; os DROP/CREATE vão para a vaga via TEST_DATABASE_URL).
# Monta a URL como o montar-banco-testes: host/usuário do pooler pela API de gestão + a senha do segredo já existente.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN ausente}" "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD ausente}"
pool=$(curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/horsymhsinqcimflrtjo/config/database/pooler)
host=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_host // empty' <<< "$pool")
user=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_user // empty' <<< "$pool")
[ -n "$host" ] && [ -n "$user" ] || { echo "nao achei o pooler da producao na API de gestao" >&2; exit 1; }
senha=$(jq -rn --arg s "$SUPABASE_DB_PASSWORD" '$s | @uri')
printf 'postgresql://%s:%s@%s:5432/postgres' "$user" "$senha" "$host"
