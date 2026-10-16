#!/usr/bin/env bash
# patch-id do CONTEÚDO de uma PR (CEO 06/10, regra c): o "MERGE AUTORIZADO" vale para o conteúdo, não para o SHA.
# É o `git patch-id --stable` do diff da PR contra o ponto onde ela sai da main (merge-base). Atualizar a PR com a
# main (merge da main no ramo) NÃO muda o patch-id; mudar o código da PR muda — e a autorização deixa de valer.
#
# Uso:  scripts/merge/patch-id.sh <nº da PR>        (busca refs/pull/N/head e a main no origin)
#       scripts/merge/patch-id.sh <commit-ish>      (ex.: HEAD, para conferir o próprio ramo antes de pedir revisão)
# A fila também aceita o id ABREVIADO (>= 8 hex, ex.: "920770c9…") se casar com um só conteúdo.
# O gilberto-revisor cola no comentário:  MERGE AUTORIZADO #N — gilberto-revisor · patch-id <40 hex>
set -euo pipefail
alvo="${1:?uso: scripts/merge/patch-id.sh <nº da PR | commit>}"
git fetch -q origin main
# clone raso (sessão do revisor): sem o ponto de partida da PR o merge-base falha e o patch-id saía vazio ("sem patch-id").
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then git fetch -q --unshallow origin main 2> /dev/null || git fetch -q --depth=5000 origin main || true; fi
if [[ "$alvo" =~ ^[0-9]+$ ]]; then
  git fetch -q origin "pull/$alvo/head:refs/fila/pr-$alvo" --force
  alvo="refs/fila/pr-$alvo"
fi
base=$(git merge-base origin/main "$alvo")
# Estável à renumeração de migration pela fila (scripts/merge/patch-id-estavel.sh): só o prefixo de versão do nome é normalizado.
pid=$(git diff "$base" "$alvo" | "$(dirname "$0")/patch-id-estavel.sh")
[ -n "$pid" ] || { echo "erro: patch-id vazio para $alvo (diff vazio ou merge-base ausente)" >&2; exit 1; }
echo "$pid"
