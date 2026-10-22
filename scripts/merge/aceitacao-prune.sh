#!/usr/bin/env bash
# Prune da fila de aceitação (CEO 10/10, sessão interativa) — libera a VAGA ÚNICA (demo-e2e) cancelando runs do
# aceitacao-pr.yml que a ocupam à toa:
#   · PR já MERGED/CLOSED (a versão morreu quando a PR saiu);
#   · SHA superado/órfão: não é a cabeça de nenhuma PR aberta nem a cabeça da main.
# Mantém intacto: a versão VIVA de PR aberta (head atual), o run do commit da main, e — na triagem — o SHA da própria
# rodada (SELF_SHA). NÃO toca na serialização (grupo demo-e2e), no timeout nem na decisão de merge. Idempotente.
# Chamado pela triagem do aceitacao-pr.yml (a cada deployment_status, barato) e pelo vigia-runs.yml (a cada 10 min,
# rede de segurança). Sem GH_TOKEN/REPO não faz nada.
#
# Uso: GH_TOKEN=<token> REPO=dono/repo [SELF_RUN_ID=<id>] [SELF_SHA=<sha>] scripts/merge/aceitacao-prune.sh
set -uo pipefail
: "${GH_TOKEN:?GH_TOKEN ausente}" "${REPO:?REPO ausente}"
api() { gh api -H 'Accept: application/vnd.github+json' "$@" 2>/dev/null; }

MAIN_HEAD=$(api "repos/$REPO/commits/main" --jq '.sha' || true)
self_run="${SELF_RUN_ID:-}"; self_sha="${SELF_SHA:-}"
n=0
# in_progress inclui os runs presos na fila de concorrência (sem step) — é lá que eles ficam 2h; por isso entra aqui.
for st in queued waiting in_progress; do
  for rid in $(api "repos/$REPO/actions/workflows/aceitacao-pr.yml/runs?status=$st&per_page=100" --jq '.workflow_runs[].id' || true); do
    [ -n "$rid" ] || continue
    [ "$rid" = "$self_run" ] && continue
    hsha=$(api "repos/$REPO/actions/runs/$rid" --jq '.head_sha' || true)
    [ -n "$hsha" ] || continue
    [ "$hsha" = "$self_sha" ] && continue          # a triagem não mexe no SHA da própria rodada
    [ "$hsha" = "$MAIN_HEAD" ] && continue          # run de commit da main → mantém
    # versão VIVA = existe PR ABERTA cuja cabeça é exatamente este SHA
    viva=$(api "repos/$REPO/commits/$hsha/pulls" --jq "[.[] | select(.state==\"open\" and .head.sha==\"$hsha\")] | length" || echo 0)
    [ "${viva:-0}" -gt 0 ] && continue
    # senão: PR mergeada/fechada OU SHA superado/órfão → vaga desperdiçada
    motivo=$(api "repos/$REPO/commits/$hsha/pulls" --jq 'if length==0 then "SHA órfão (sem PR)" else "PR #\(.[0].number) \(.[0].state) — SHA não é o head atual" end' || echo "versão morta")
    echo "prune: cancelando aceitação run $rid (head ${hsha:0:7}) — $motivo"
    api -X POST "repos/$REPO/actions/runs/$rid/cancel" >/dev/null || true
    n=$((n + 1))
  done
done
echo "prune: $n run(s) de aceitação cancelado(s) (vaga liberada)"
