#!/usr/bin/env bash
# Onda de auto-update + auto-merge (CEO 12/10, prioridade máxima — estabilizar a esteira).
#
# Problema: a esteira entra em serrilhado — escoa uma leva e entope de novo — porque a CI fica SATURADA de check runs
# (re-run/update-branch em MASSA). Empurrar mais PIORA. A cura é drenar em ONDAS CONTROLADAS: a cada rodada, atualizar
# o branch de SÓ 3–5 PRs com a main e deixar o auto-merge (squash) ligado neles; na rodada seguinte, as próximas 3–5.
# Assim a fila escoa sozinha, sem floodar os runners.
#
# Segurança (sem bypass):
#  - NUNCA toca PR `revisao-eng-chefe` (sensível): essas dependem da autorização do revisor pela fila-merge. Auto-merge
#    aqui poderia publicar no verde do CI sem a revisão → fora.
#  - NUNCA toca draft, `nao-publicar`, outra base ou fork.
#  - Conflito REAL (DIRTY) ou check VERMELHO de verdade (não pendente) → NÃO insiste: marca, reporta e segue.
#  - Auto-merge SEMPRE via `gh pr merge --auto --squash` (gh CLI nativo) — nunca a mutation GraphQL (RD-34 V5). Respeita
#    a proteção de branch: só publica quando os checks exigidos ficam verdes.
#  - O teto por rodada (ONDA_MAX, 3–5) é o que impede re-saturar a CI: no máximo esse tanto de update-branch por rodada.
set -uo pipefail
: "${GH_TOKEN:?GH_TOKEN (FILA_MERGE_TOKEN) ausente}" "${REPO:?REPO ausente}"

# teto da onda: 3–5 (padrão 4). Fora da faixa → clampa; a onda é o freio contra o flood.
ONDA_MAX=${ONDA_MAX:-4}
case "$ONDA_MAX" in ''|*[!0-9]*) ONDA_MAX=4;; esac
[ "$ONDA_MAX" -ge 3 ] 2>/dev/null || ONDA_MAX=3
[ "$ONDA_MAX" -le 5 ] 2>/dev/null || ONDA_MAX=5

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
say() { echo "$*"; }
resumo() { echo "$*" >> "$SUMMARY"; }

resumo "### Onda de auto-update + auto-merge (teto ${ONDA_MAX} update-branch/rodada)"
resumo "| PR | ação | estado |"
resumo "|---:|---|---|"

# Candidatas: abertas, base main, não-draft, mesmo repo (não-fork), sem `nao-publicar` nem `revisao-eng-chefe`.
# Ordem: mais ANTIGA primeiro (antiguidade = prioridade de fila). Uma só chamada de lista (cota da API).
cand=$(gh pr list --repo "$REPO" --state open --base main --limit 200 \
  --json number,createdAt,isDraft,isCrossRepository,labels \
  --jq '[ .[]
          | select(.isDraft == false and .isCrossRepository == false)
          | select([.labels[].name] | (index("nao-publicar") or index("revisao-eng-chefe")) | not)
        ] | sort_by(.createdAt) | .[].number') || { echo "::error::falha ao listar PRs"; exit 1; }

if [ -z "$cand" ]; then say "nenhuma PR via-rápida aberta na fila"; resumo "| — | — | fila vazia |"; exit 0; fi

usadas=0          # quantos update-branch já gastamos nesta rodada (o freio)
examinadas=0      # teto de PRs inspecionadas por rodada (poupa cota da API)
automerge=0; conflitos=0; vermelhas=0

for n in $cand; do
  [ "$usadas" -lt "$ONDA_MAX" ] || { say "teto da onda ($ONDA_MAX) atingido — as próximas seguem na próxima rodada"; break; }
  examinadas=$((examinadas + 1))
  [ "$examinadas" -le 40 ] || { say "teto de inspeção por rodada atingido"; break; }

  info=$(gh pr view "$n" --repo "$REPO" --json mergeStateStatus,headRefOid,state 2>/dev/null) || { say "#$n: não consegui ler o estado — pulo"; continue; }
  [ "$(jq -r '.state' <<<"$info")" = OPEN ] || continue
  estado=$(jq -r '.mergeStateStatus' <<<"$info")
  head=$(jq -r '.headRefOid' <<<"$info")

  # Conflito REAL → não insiste.
  if [ "$estado" = DIRTY ]; then
    say "#$n: CONFLITO (DIRTY) — marco e sigo, não forço"
    resumo "| #$n | pulada | conflito real (resolver à mão) |"
    conflitos=$((conflitos + 1)); continue
  fi

  # Check VERMELHO de verdade (bucket=fail; pendente não conta) → não insiste.
  reds=$(gh pr checks "$n" --repo "$REPO" --json bucket --jq '[.[]|select(.bucket=="fail")]|length' 2>/dev/null || echo 0)
  if [ "${reds:-0}" -gt 0 ]; then
    say "#$n: $reds check(s) VERMELHO(s) — marco e sigo, não forço"
    resumo "| #$n | pulada | $reds check vermelho (não pendente) |"
    vermelhas=$((vermelhas + 1)); continue
  fi

  # Garante auto-merge (squash) ligado. Respeita a proteção de branch; só publica no verde. Idempotente.
  if gh pr merge "$n" --repo "$REPO" --auto --squash >/dev/null 2>&1; then
    automerge=$((automerge + 1)); am="auto-merge on"
  else
    am="auto-merge já on / indisponível"
  fi

  # Atualiza com a main SÓ se estiver atrás (consome uma vaga da onda — é o custo de CI que precisa ser racionado).
  if [ "$estado" = BEHIND ]; then
    if gh api -X PUT "repos/$REPO/pulls/$n/update-branch" -f expected_head_sha="$head" >/dev/null 2>&1; then
      usadas=$((usadas + 1))
      say "#$n: atrás da main → update-branch (onda $usadas/$ONDA_MAX) · $am"
      resumo "| #$n | update-branch + $am | onda $usadas/$ONDA_MAX |"
    else
      say "#$n: update-branch recusado (head mudou ou já em dia) · $am"
      resumo "| #$n | só $am | update-branch não aplicado |"
    fi
  else
    say "#$n: em dia/${estado} → só garanto $am (sem gastar vaga da onda)"
    resumo "| #$n | $am | ${estado} |"
  fi
done

resumo ""
resumo "**Resumo:** ${usadas}/${ONDA_MAX} update-branch · ${automerge} auto-merge ligado · ${conflitos} conflito(s) · ${vermelhas} vermelha(s)."
say "onda: ${usadas}/${ONDA_MAX} update-branch, ${automerge} auto-merge, ${conflitos} conflito, ${vermelhas} vermelha"
