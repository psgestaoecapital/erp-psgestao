#!/usr/bin/env bash
# 20/10 (gilberto-desenv, pedido do Eng. Chefe): o Montar em workflow_run falhava ~50% com
# "Remote migration versions not found in local migrations directory" (20261019122120, 20261019145520…): carimbo de
# horário-de-aplicação (RD-52) deixado no ledger da vaga 0 por uma aceitação/execução fora do fluxo, sem arquivo no repo.
# O `db push` aborta por desenho e o Montar inteiro (catálogos, semente, fn_demo_reset) morria em segundos.
# Poda SÓ o ledger do banco de TESTES: remove versões sem arquivo em supabase/migrations e <= a maior versão do repo.
# Nunca toca a produção (trava) e nunca toca versão com arquivo. Os objetos da PR (se houver) são desfeitos pelo
# reconciliar-vaga / recriar; aqui só se destrava o ledger para o db push convergir.
# Uso: TEST_DATABASE_URL=<pooler de teste> scripts/banco-testes/podar-orfas-ledger.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado"; exit 1;; esac
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) echo "::error::TEST_DATABASE_URL precisa ser Session pooler"; exit 1;; esac
dir="${MIGR_DIR:-supabase/migrations}"
vs=$(ls "$dir"/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort)
[ -n "$vs" ] || { echo "::error::sem migrations em $dir"; exit 1; }
max=$(tail -1 <<< "$vs")
lista=$(sed "s/.*/'&'/" <<< "$vs" | paste -sd,)
orf=$(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select version from supabase_migrations.schema_migrations where version <= '$max' and version not in ($lista) order by 1")
if [ -z "$orf" ]; then echo "ledger da vaga sem órfãos (versão sem arquivo)"; exit 0; fi
echo "::warning title=Órfãos no ledger da vaga::podando versões sem arquivo no repo: $(paste -sd' ' <<< "$orf")"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "delete from supabase_migrations.schema_migrations where version <= '$max' and version not in ($lista)"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "### Ledger da vaga: órfãos podados antes do db push: $(paste -sd' ' <<< "$orf")" >> "$GITHUB_STEP_SUMMARY"
