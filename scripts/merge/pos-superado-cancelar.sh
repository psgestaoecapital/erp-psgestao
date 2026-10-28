#!/usr/bin/env bash
# @pos-migration SUPERADO (gilberto-desenv 23/10, tarefa "drenagem - destravar"): cada merge na main gera um run do
# aceitacao-pos-migration.yml, e todos entram na fila FIFO demo-e2e (queue: max). Em 23/10 havia 7 runs de SHAs antigos
# esperando desde 19:16 enquanto o 779 rodava; a fila de merge olha SÓ o run MAIS NOVO (estado_main, per_page=1), então
# toda migration CRÍTICA esperava a pilha inteira rodar (~horas) só para chegar a vez do último.
# O run mais novo julga a produção que já contém tudo dos anteriores (o banco tem todas as migrations e a Vercel serve a
# ponta — o próprio job aceita servir um commit POSTERIOR). Logo, run ESPERANDO a vez que não é o mais novo é superado:
# cancela. Nunca toca: o run mais novo, run com job já EXECUTANDO (runner pegou), nem o que não está esperando.
# Cancelado não é vermelho (regra a) e o vigia não re-roda SHA que não é a ponta da main. Idempotente.
#
# Uso: GH_TOKEN=<token> REPO=dono/repo scripts/merge/pos-superado-cancelar.sh
set -uo pipefail
: "${GH_TOKEN:?GH_TOKEN ausente}" "${REPO:?REPO ausente}"
api() { gh api -H 'Accept: application/vnd.github+json' "$@" 2>/dev/null; }
WF=${WF:-aceitacao-pos-migration.yml}

ult=$(api "repos/$REPO/actions/workflows/$WF/runs?branch=main&per_page=1" --jq '.workflow_runs[0].id' || true)
[ -n "$ult" ] && [ "$ult" != null ] || { echo "pos-superado: sem run do @pos na main, nada a fazer"; exit 0; }
n=0
# in_progress entra porque o run pode estar "em andamento" com o job ainda esperando a vez no grupo de concorrência
for st in pending queued waiting in_progress; do
  for rid in $(api "repos/$REPO/actions/workflows/$WF/runs?branch=main&status=$st&per_page=50" --jq '.workflow_runs[].id' || true); do
    [ -n "$rid" ] || continue
    [ "$rid" -lt "$ult" ] 2>/dev/null || continue   # o mais novo (e qualquer um posterior) fica
    # job já pegou runner (executando) → nunca cancela aqui (o teto de tempo é do resto do vigia)
    rodando=$(api "repos/$REPO/actions/runs/$rid/jobs" --jq '[.jobs[] | select(.status=="in_progress" and (.runner_name // "") != "")] | length' || echo 1)
    [ "${rodando:-1}" -eq 0 ] 2>/dev/null || continue
    echo "pos-superado: cancelando @pos run $rid (esperando a vez; o run $ult, mais novo, julga a mesma produção)"
    api -X POST "repos/$REPO/actions/runs/$rid/cancel" >/dev/null || true
    n=$((n + 1))
  done
done
echo "pos-superado: $n run(s) do @pos superado(s) cancelado(s)"
