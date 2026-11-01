#!/usr/bin/env bash
# Sorteio de vaga da aceitação de PR CIENTE DE OCUPAÇÃO (CEO 18/10, sessão interativa).
#
# Antes: a vaga era (run_number+run_attempt) % N, às cegas — duas PRs caíam na mesma vaga com outra livre, e a fila
# de concorrência (aceitacao-testes-<vaga>) prendia PRs por horas. Agora: escolhe a vaga de PR com MENOS runs
# ATIVOS+NA FILA (empate → menor número). Se a consulta de ocupação falhar (sem token, erro de API, nada), cai no
# sorteio antigo (determinístico) sobre as MESMAS vagas elegíveis — nunca quebra.
#
# A vaga 1 é RESERVADA para a aceitação da MAIN (grupo aceitacao-testes-1) e NUNCA é sorteada para PR. PRs usam só
# as vagas 0 e 2 (a 2 apenas quando provisionada: URL2 presente e ACEITACAO_VAGAS>=3). Com ACEITACAO_VAGAS=1 (padrão)
# só a vaga 0 é elegível → serial, idêntico a antes.
#
# Ocupação por vaga (sem depender de renomear o check obrigatório "aceitacao"): lista os runs do aceitacao-pr.yml
# ativos/na fila; para cada run cujo job "aceitacao" está queued/in_progress/pending/waiting (ocupando ou esperando a vaga;
# pending/waiting = preso no grupo de concorrência, que antes NÃO contava e deixava a vaga 0 parecer livre), lê a vaga
# escolhida no LOG da triagem (marcador estável ACEITACAO_VAGA_ESCOLHIDA=<n>, que o aceitacao-pr.yml emite). Só o gh é
# externo (mockável no gate). NÃO toca produção.
#
# Uso: VAGAS=<n> URL1=<...> URL2=<...> RUN=<run_number+run_attempt> REPO=dono/repo GH_TOKEN=<tok> \
#        [SELF_RUN_ID=<id>] scripts/merge/aceitacao-sortear-vaga.sh   # imprime só o número da vaga
set -uo pipefail

VAGAS="${VAGAS:-1}"; case "$VAGAS" in ''|*[!0-9]*) VAGAS=1;; esac; [ "$VAGAS" -ge 1 ] || VAGAS=1
RUN="${RUN:-0}";     case "$RUN"   in ''|*[!0-9]*) RUN=0;;   esac

# Vagas elegíveis para PR: 0 sempre; 2 quando provisionada (URL2) e ACEITACAO_VAGAS>=3. A vaga 1 fica fora (é da main).
elig=(0)
if [ "$VAGAS" -ge 3 ] && [ -n "${URL2:-}" ]; then elig+=(2); fi
n=${#elig[@]}

# Sorteio antigo (determinístico), já restrito às vagas elegíveis: é o fallback e o caminho sem o que consultar.
fallback() { echo "${elig[$(( RUN % n ))]}"; }

# Nada a distribuir (1 vaga elegível) ou sem como consultar a ocupação → fallback.
if [ "$n" -le 1 ] || [ -z "${GH_TOKEN:-}" ] || [ -z "${REPO:-}" ]; then fallback; exit 0; fi

api() { gh api -H 'Accept: application/vnd.github+json' "$@" 2>/dev/null; }

declare -A cnt
for v in "${elig[@]}"; do cnt[$v]=0; done
erro=0
for st in in_progress queued pending waiting; do   # pending/waiting = esperando o grupo de concorrência (CEO 18/10)
  ids=$(api "repos/$REPO/actions/workflows/aceitacao-pr.yml/runs?status=$st&per_page=100" --jq '.workflow_runs[].id') || { erro=1; break; }
  for rid in $ids; do
    [ -n "$rid" ] || continue
    [ "$rid" = "${SELF_RUN_ID:-}" ] && continue      # não conta o próprio run desta rodada
    acc=$(api "repos/$REPO/actions/runs/$rid/jobs" --jq '[.jobs[]|select(.name=="aceitacao")|.status]|first // empty') || { erro=1; break; }
    case "$acc" in queued|in_progress|pending|waiting) : ;; *) continue;; esac   # só conta quem ocupa/aguarda a vaga
    tjid=$(api "repos/$REPO/actions/runs/$rid/jobs" --jq '[.jobs[]|select(.name=="triagem")|.id]|first // empty') || { erro=1; break; }
    [ -n "$tjid" ] || continue
    vg=$(api "repos/$REPO/actions/jobs/$tjid/logs" | sed -nE 's/.*ACEITACAO_VAGA_ESCOLHIDA=([0-9]+).*/\1/p' | tail -1)
    [ -n "$vg" ] || continue
    case " ${elig[*]} " in *" $vg "*) cnt[$vg]=$(( ${cnt[$vg]} + 1 ));; esac
  done
  [ "$erro" = 1 ] && break
done
[ "$erro" = 1 ] && { fallback; exit 0; }

# Vaga elegível com menos ocupação; empate → menor número (elig está em ordem crescente, o primeiro vence).
melhor="${elig[0]}"; min="${cnt[${elig[0]}]}"
for v in "${elig[@]}"; do
  if [ "${cnt[$v]}" -lt "$min" ]; then min="${cnt[$v]}"; melhor="$v"; fi
done
echo "$melhor"
