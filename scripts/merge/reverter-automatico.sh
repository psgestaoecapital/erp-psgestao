#!/usr/bin/env bash
# Revert automático pós-merge (CEO 22/10 — ESTEIRA CONTÍNUA). A rede de segurança do novo desenho: como a aceitação
# deixou de ser porteiro do merge (vira verificação pós-merge), quando a verificação da main fica VERMELHA a fila
# RESTAURA a main sozinha, em vez de travar. Chamado pelo aceitacao-main.yml DEPOIS do main-vermelha.sh, no vermelho.
#
# Reverte automaticamente SÓ no caso inequívoco e seguro — fora dele, NÃO reverte (a issue main-vermelha + o humano
# decidem). As três travas (todas obrigatórias):
#   (1) NÃO-FLAKY: a aceitação da main está vermelha AGORA e já estava vermelha no run ANTERIOR (2 reds seguidos).
#   (2) ATRIBUIÇÃO 1:1: desde o último verde há EXATAMENTE UMA PR publicada (sabemos a culpada) — e não é um revert.
#   (3) SEM MIGRATION: a PR culpada não toca supabase/migrations (revert de migration precisa de down-migration =
#       decisão humana). Migration → só alerta, não reverte.
# No caso bom: abre uma PR de revert (git revert do squash) que a fila publica pela via rápida → main restaurada em
# minutos; comenta na PR original. Idempotente: não abre um segundo revert se já houver um aberto para a mesma PR.
#
# Uso: GH_TOKEN=… REPO=dono/repo SHA=<main vermelha> RUN_URL=… [REVERT_AUTO=1] scripts/merge/reverter-automatico.sh
# REVERT_AUTO!=1 → modo observação (diz o que FARIA, sem abrir PR) — liga com segurança depois do OK do CEO.
set -euo pipefail
: "${GH_TOKEN:?}" "${REPO:?}" "${SHA:?}" "${RUN_URL:?}"
api() { gh api -H 'Accept: application/vnd.github+json' "$@"; }
nota() { echo "revert-auto: $*"; }

# (1) NÃO-FLAKY — o run imediatamente anterior da aceitacao-main também foi failure?
anterior=$(api "repos/$REPO/actions/workflows/aceitacao-main.yml/runs?branch=main&per_page=8" \
  --jq '[.workflow_runs[] | select(.conclusion=="success" or .conclusion=="failure")][1].conclusion // empty' 2>/dev/null || echo '')
if [ "$anterior" != failure ]; then
  nota "só 1 vermelho (anterior=${anterior:-nenhum}) — pode ser flaky; não reverte, aguarda o próximo run confirmar."
  exit 0
fi

# (2) ATRIBUIÇÃO 1:1 — PRs publicadas desde o último verde da aceitacao-main
verde=$(api "repos/$REPO/actions/workflows/aceitacao-main.yml/runs?branch=main&status=success&per_page=1" \
  --jq '.workflow_runs[0].head_sha // empty' 2>/dev/null || echo '')
if [ -z "$verde" ] || ! git cat-file -e "$verde^{commit}" 2>/dev/null; then
  nota "sem verde registrado na faixa — não reverte (atribuição indefinida)."; exit 0
fi
# número e título (squash: "… (#NNNN)"), descartando PRs de revert
reais=(); declare -A titulo_de
while IFS=$'\t' read -r h t; do
  n=$(sed -nE 's/^.* \(#([0-9]+)\)$/\1/p' <<<"$t"); [ -n "$n" ] || continue
  case "$t" in Revert\ *|revert*|*"revert automático"*) continue;; esac
  reais+=("$n"); titulo_de[$n]="$h"
done < <(git log --format='%H%x09%s' "$verde..$SHA")
if [ "${#reais[@]}" -ne 1 ]; then
  nota "${#reais[@]} PRs na faixa desde o verde — atribuição ambígua; não reverte (main-vermelha + humano decidem)."
  exit 0
fi
culpada=${reais[0]}; sq=${titulo_de[$culpada]}

# (3) SEM MIGRATION
arquivos=$(api "repos/$REPO/pulls/$culpada/files?per_page=100" --jq '.[].filename' 2>/dev/null || echo '')
if grep -qE '^supabase/migrations/' <<<"$arquivos"; then
  nota "#$culpada é a única suspeita mas tem MIGRATION — revert precisa de down-migration (decisão humana); não reverte."
  api -X POST "repos/$REPO/issues/$culpada/comments" -f body="⚠️ **Revert automático NÃO aplicado** — a aceitação da main está vermelha (2 runs) e #$culpada é a única suspeita, mas ela tem **migration**: o revert precisa de uma down-migration (decisão humana). Ver a issue \`main-vermelha\`. $RUN_URL" > /dev/null 2>&1 || true
  exit 0
fi

# idempotência: já há revert aberto para essa PR?
ja=$(api "repos/$REPO/pulls?state=open&per_page=60" --jq "[.[] | select(.title | test(\"Revert #$culpada( |\\\\b)\"))] | length" 2>/dev/null || echo 0)
if [ "${ja:-0}" -ne 0 ]; then nota "já há PR de revert aberta para #$culpada; nada a fazer."; exit 0; fi

if [ "${REVERT_AUTO:-0}" != 1 ]; then
  nota "[observação] REVERTERIA #$culpada (squash ${sq:0:7}, sem migration, 2 reds). Ligue com REVERT_AUTO=1."
  exit 0
fi

ramo="revert-auto/$culpada-$(date -u +%s)"
git config user.name "fila-merge"; git config user.email "fila-merge@users.noreply.github.com"
git checkout -b "$ramo" "$SHA" > /dev/null 2>&1
if ! git revert --no-edit -m 1 "$sq" > /dev/null 2>&1 && ! git revert --no-edit "$sq" > /dev/null 2>&1; then
  git revert --abort > /dev/null 2>&1 || true
  nota "git revert de #$culpada conflitou — decisão humana."
  api -X POST "repos/$REPO/issues/$culpada/comments" -f body="⚠️ **Revert automático NÃO aplicado**: o \`git revert\` de #$culpada conflitou (decisão humana). Ver issue \`main-vermelha\`. $RUN_URL" > /dev/null 2>&1 || true
  exit 0
fi
git push origin "$ramo" > /dev/null 2>&1
corpo="🔄 **Revert automático** (esteira contínua — CEO 22/10). A aceitação da main ficou **vermelha em 2 runs seguidos** e #$culpada é a ÚNICA PR publicada desde o último verde e **sem migration** → revertida sozinha para restaurar a main (em vez de travar a fila). $RUN_URL

Code dono: investigar o que quebrou e reabrir a mudança corrigida. Via rápida (sem migration).

Code: gilberto-desenv"
pr=$(api -X POST "repos/$REPO/pulls" -f title="Revert #$culpada (revert automático: main vermelha)" -f head="$ramo" -f base=main -f body="$corpo" --jq '.number')
nota "PR de revert #$pr aberta para #$culpada (a fila publica pela via rápida)."
api -X POST "repos/$REPO/issues/$culpada/comments" -f body="🔄 **Revert automático** aberto: #$pr (aceitação da main vermelha em 2 runs; #$culpada sem migration). A main será restaurada quando #$pr publicar. $RUN_URL" > /dev/null 2>&1 || true
