#!/usr/bin/env bash
# Issue "main-vermelha" da aceitação da main (CEO 07/10 08:05 — esteira em 2 velocidades, TEMPORÁRIA).
# Chamado pelo aceitacao-main.yml depois da suíte. Só API REST (gh api).
#   RESULTADO=success → fecha a issue aberta (comentando o run verde).
#   qualquer outro (failure; skipped = a main nem buildou/subiu) → abre UMA issue, ou atualiza a que já está aberta,
#   com as PRs publicadas desde o último verde e o link do run. Regra: corrigir em 1 h ou reverter.
# Uso: GH_TOKEN=… REPO=dono/repo SHA=<main> RESULTADO=<outcome> RUN_URL=… scripts/merge/main-vermelha.sh
set -euo pipefail
: "${GH_TOKEN:?}" "${REPO:?}" "${SHA:?}" "${RESULTADO:?}" "${RUN_URL:?}"
LABEL=main-vermelha
api() { gh api -H 'Accept: application/vnd.github+json' "$@"; }

aberta=$(api "repos/$REPO/issues?state=open&labels=$LABEL&per_page=1" --jq '.[0].number // empty')

if [ "$RESULTADO" = success ]; then
  if [ -n "$aberta" ]; then
    api -X POST "repos/$REPO/issues/$aberta/comments" -f body="✅ Aceitação da main **verde** em \`${SHA:0:7}\`: $RUN_URL — issue fechada." > /dev/null
    api -X PATCH "repos/$REPO/issues/$aberta" -f state=closed -f state_reason=completed > /dev/null
    echo "main verde: issue #$aberta fechada"
  else
    echo "main verde: nenhuma issue $LABEL aberta"
  fi
  exit 0
fi

# PRs publicadas desde o último verde (squash: o título do commit termina em "(#NNNN)")
verde=$(api "repos/$REPO/actions/workflows/aceitacao-main.yml/runs?branch=main&status=success&per_page=1" \
  --jq '.workflow_runs[0].head_sha // empty')
if [ -n "$verde" ] && git cat-file -e "$verde^{commit}" 2> /dev/null; then
  faixa="$verde..$SHA"; desde="desde o último verde (\`${verde:0:7}\`)"
else
  faixa="-20 $SHA"; desde="(sem verde registrado: últimos 20 commits da main)"
fi
# shellcheck disable=SC2086
prs=$(git log --format='%s' $faixa | sed -nE 's/^(.*) \(#([0-9]+)\)$/- #\2 — \1/p')
[ -n "$prs" ] || prs="- (nenhuma PR identificada na faixa)"

titulo="Main vermelha na aceitação (banco de testes) — corrigir em 1 h ou reverter"
corpo="🔴 **Aceitação da main vermelha** em \`${SHA:0:7}\` ($RESULTADO): $RUN_URL

Regra do CEO (07/10, esteira em 2 velocidades — temporária): **corrigir em 1 h ou reverter** a PR culpada
(código + migration que devolve o estado anterior, se houver).

PRs publicadas $desde:
$prs"

api -X POST "repos/$REPO/labels" -f name="$LABEL" -f color=d73a4a \
  -f description="Aceitação da main vermelha no banco de testes (corrigir em 1 h ou reverter)" > /dev/null 2>&1 || true
if [ -n "$aberta" ]; then
  api -X PATCH "repos/$REPO/issues/$aberta" -f title="$titulo" -f body="$corpo" > /dev/null
  api -X POST "repos/$REPO/issues/$aberta/comments" -f body="🔴 Ainda vermelha em \`${SHA:0:7}\`: $RUN_URL" > /dev/null
  echo "main vermelha: issue #$aberta atualizada"
else
  n=$(api -X POST "repos/$REPO/issues" -f title="$titulo" -f body="$corpo" -f "labels[]=$LABEL" --jq '.number')
  echo "main vermelha: issue #$n aberta"
fi
echo "::error title=main vermelha::aceitação da main vermelha em ${SHA:0:7} — corrigir em 1 h ou reverter"
