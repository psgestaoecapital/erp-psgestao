#!/usr/bin/env bash
# Monta o BANCO DE TESTES (erp-psgestao-testes): aplica TODAS as migrations do repo, em ordem de nome, uma por vez.
# Nunca aponta para produção: aborta se TEST_DATABASE_URL contiver o ref da produção.
# Falha numa migration NÃO derruba a montagem: fica em banco-testes-falhas.tsv (arquivo \t primeira linha do erro) para
# tratamento (marcador em scripts/banco-testes/pular.txt ou migration de compensação — nunca editar migration já aplicada em produção).
set -u
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
PROD_REF=horsymhsinqcimflrtjo
if [[ "$TEST_DATABASE_URL" == *"$PROD_REF"* ]]; then echo "ABORTADO: TEST_DATABASE_URL aponta para a produção"; exit 2; fi

DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PULAR="$DIR/scripts/banco-testes/pular.txt"
FALHAS="${FALHAS_OUT:-banco-testes-falhas.tsv}"; : > "$FALHAS"
export PGOPTIONS='-c statement_timeout=300000'
t0=$(date +%s); ok=0; pul=0; fal=0

# Extensões disponíveis no Free (as que a produção usa); as que não existirem só avisam.
for ext in pgcrypto uuid-ossp pg_trgm unaccent pg_cron pg_net vault citext btree_gin btree_gist; do
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=0 -qc "CREATE EXTENSION IF NOT EXISTS \"$ext\"" >/dev/null 2>&1 \
    && echo "ext ok: $ext" || echo "::warning::extensão indisponível: $ext"
done

# Ledger próprio no banco de testes (evita reaplicar em rodadas seguintes).
psql "$TEST_DATABASE_URL" -qc "CREATE TABLE IF NOT EXISTS public._banco_testes_ledger(versao text primary key, nome text, aplicada_em timestamptz default now())" >/dev/null

for f in $(ls "$DIR"/supabase/migrations/*.sql | sort); do
  b=$(basename "$f"); v=${b%%_*}
  if [ -f "$PULAR" ] && grep -qE "^${v}( |$)" "$PULAR"; then pul=$((pul+1)); echo "pulada (marcador): $b"; continue; fi
  ja=$(psql "$TEST_DATABASE_URL" -Atqc "SELECT 1 FROM public._banco_testes_ledger WHERE versao='$v'")
  [ "$ja" = "1" ] && { ok=$((ok+1)); continue; }
  if err=$(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$f" 2>&1 >/dev/null); then
    psql "$TEST_DATABASE_URL" -qc "INSERT INTO public._banco_testes_ledger(versao,nome) VALUES ('$v','$b')" >/dev/null
    ok=$((ok+1))
  else
    fal=$((fal+1)); printf '%s\t%s\n' "$b" "$(echo "$err" | grep -m1 -i 'error' | tr '\t' ' ')" >> "$FALHAS"
  fi
done
dt=$(( $(date +%s) - t0 ))
echo "MONTAGEM: ok=$ok puladas=$pul falhas=$fal tempo=${dt}s"
{ echo "### Banco de testes: ok=$ok · puladas=$pul · falhas=$fal · ${dt}s"; [ -s "$FALHAS" ] && { echo '```'; head -60 "$FALHAS"; echo '```'; }; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 0
