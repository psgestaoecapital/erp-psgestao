#!/usr/bin/env bash
# patch-id do CONTEÚDO de uma PR (CEO 06/10, regra c): o "MERGE AUTORIZADO" vale para o conteúdo, não para o SHA.
# É o `git patch-id --stable` do diff da PR contra o ponto onde ela sai da main (merge-base). Atualizar a PR com a
# main (merge da main no ramo) NÃO muda o patch-id; mudar o código da PR muda — e a autorização deixa de valer.
#
# Uso:  scripts/merge/patch-id.sh <nº da PR>        (busca refs/pull/N/head e a main no origin)
#       scripts/merge/patch-id.sh <commit-ish>      (ex.: HEAD, para conferir o próprio ramo antes de pedir revisão)
# O gilberto-revisor cola no comentário:  MERGE AUTORIZADO #N — gilberto-revisor · patch-id <40 hex>
set -euo pipefail
alvo="${1:?uso: scripts/merge/patch-id.sh <nº da PR | commit>}"
git fetch -q origin main
if [[ "$alvo" =~ ^[0-9]+$ ]]; then
  git fetch -q origin "pull/$alvo/head:refs/fila/pr-$alvo" --force
  alvo="refs/fila/pr-$alvo"
fi
base=$(git merge-base origin/main "$alvo")
git diff "$base" "$alvo" | git patch-id --stable | cut -d' ' -f1
