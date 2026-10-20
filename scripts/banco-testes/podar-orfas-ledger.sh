#!/usr/bin/env bash
# 20/10 (gilberto-desenv, pedido do Eng. Chefe): o Montar em workflow_run falhava ~50% com
# "Remote migration versions not found in local migrations directory" (20261019122120, 20261019145520…): carimbo de
# horário-de-aplicação (RD-52) deixado no ledger da vaga 0 por uma aceitação/execução fora do fluxo, sem arquivo no repo.
# O `db push` aborta por desenho e o Montar inteiro (catálogos, semente, fn_demo_reset) morria em segundos.
# Poda SÓ o ledger do banco de TESTES: remove TODA versão sem arquivo em supabase/migrations — ACIMA ou ABAIXO da maior
# versão do repo. (20/10 gilberto-desenv/rodrigo-code: a trava "<= maior versão" deixava passar órfã ACIMA da main — ex.:
# 20261020130020, versão de migration de PR não mergeada/renumerada aplicada na vaga e nunca desfeita (run cancelado antes
# do teardown). Essa órfã acima do max fazia o `db push` abortar e o pruner não a pegava.) O invariante é simples: versão
# no ledger SEM arquivo no repo = órfã → remove. As ~950 históricas TÊM arquivo, então nunca entram.
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
lista=$(sed "s/.*/'&'/" <<< "$vs" | paste -sd,)
# órfã = versão no ledger da vaga SEM arquivo no repo (acima OU abaixo da maior — sem a trava "<= max" que deixava
# passar a órfã acima da main). Só o banco de testes; versão COM arquivo nunca entra em "not in (...)".
orf=$(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select version from supabase_migrations.schema_migrations where version not in ($lista) order by 1")
if [ -z "$orf" ]; then echo "ledger da vaga sem órfãos (versão sem arquivo)"; exit 0; fi
echo "::warning title=Órfãos no ledger da vaga::podando versões sem arquivo no repo: $(paste -sd' ' <<< "$orf")"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "delete from supabase_migrations.schema_migrations where version not in ($lista)"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "### Ledger da vaga: órfãos podados antes do db push: $(paste -sd' ' <<< "$orf")" >> "$GITHUB_STEP_SUMMARY"
