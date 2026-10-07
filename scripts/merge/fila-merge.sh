#!/usr/bin/env bash
# Fila de merge própria (CEO 06/10, regras a–d · erp_contexto_projeto 5c30d735). O merge queue do GitHub exige plano
# pago de organização (RD-42); esta fila é um workflow gratuito, acordado por EVENTOS (sem polling).
#
# Entra na fila: PR aberta, Ready, base main, do próprio repositório, com a label `fila-merge` (posta pelo Code que
# conferiu RD-94/94.1). Ordem: quem recebeu a label primeiro. UMA por vez: a 1ª da fila é atualizada com a main,
# esperada e mergeada (squash, travado no SHA conferido); só então a próxima. Por execução, no máximo 1 merge.
#
#   (a) run CANCELADO do @pos-migration não é vermelho: re-roda; se a última migration da main já teve run verde, libera.
#   (b) PR SEM migration não espera o @pos-migration: exige checks verdes + gates + Vercel + aceitação (preview).
#       PR só de .md/docs/.github não tem preview (Ignored Build Step, CEO 07/10): exige só os checks + gates.
#   (c) PR sensível (label revisao-eng-chefe) exige "MERGE AUTORIZADO #N — gilberto-revisor · patch-id <hex>" com o
#       patch-id do CONTEÚDO atual (scripts/merge/patch-id.sh). Atualizar com a main mantém; mudar o código derruba.
#   (d) vermelho de verdade (conflito, check falho, autorização inválida) → comenta o motivo e tira a label.
#
# Uso: GH_TOKEN=<PAT> REPO=dono/repo scripts/merge/fila-merge.sh   (num checkout da main com histórico completo)
# GH_TOKEN precisa ser um PAT: merge feito com o GITHUB_TOKEN NÃO dispara o deploy-migrations na main.
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN (PAT) ausente}" "${REPO:?REPO ausente}"
LABEL='fila-merge'
SENSIVEL=revisao-eng-chefe
RODAPE=$'\n\n<sub>fila-merge · '"${RUN_URL:-local}"'</sub>'
SUMARIO="${GITHUB_STEP_SUMMARY:-/dev/null}"

api() { gh api -H 'Accept: application/vnd.github+json' "$@"; }
log() { echo "$*"; echo "- $*" >> "$SUMARIO"; }
comentar() { api -X POST "repos/$REPO/issues/$1/comments" -f body="$2$RODAPE" > /dev/null; }
tirar_da_fila() {
  log "#$1 saiu da fila: $2"
  comentar "$1" "🚫 **Fila de merge:** #$1 saiu da fila — $2

Corrija e recoloque a label \`$LABEL\`."
  api -X DELETE "repos/$REPO/issues/$1/labels/$LABEL" > /dev/null 2>&1 || true
}

# re-roda um run cancelado (no máximo até a 3ª tentativa, para não girar em falso)
rerodar() {
  local id=$1 tent
  tent=$(api "repos/$REPO/actions/runs/$id" --jq '.run_attempt')
  if [ "$tent" -lt 3 ]; then api -X POST "repos/$REPO/actions/runs/$id/rerun" > /dev/null && log "run $id re-disparado (tentativa $((tent + 1)))"
  else log "run $id já teve $tent tentativas: não re-roda de novo (avise o Eng. Chefe)"; fi
}

# (a) Estado da main para PR COM migration. Ecoa: livre | esperar:<motivo>
estado_main() {
  local ult_mig r st conc id
  # deploy-migrations: rodando ou vermelho → espera (vermelho é trabalho AGORA de quem quebrou)
  r=$(api "repos/$REPO/actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=1" --jq '.workflow_runs[0] | "\(.id) \(.status) \(.conclusion)"')
  read -r id st conc <<< "$r"
  [ "$st" = completed ] || { echo "esperar:deploy-migrations da main em andamento ($id)"; return; }
  [ "$conc" = success ] || { echo "esperar:deploy-migrations da main não está verde ($conc, run $id)"; return; }

  r=$(api "repos/$REPO/actions/workflows/aceitacao-pos-migration.yml/runs?branch=main&per_page=1" --jq '.workflow_runs[0] | "\(.id) \(.status) \(.conclusion)"')
  read -r id st conc <<< "$r"
  [ "$st" = completed ] || { echo "esperar:@pos-migration da main em andamento ($id)"; return; }
  case "$conc" in
    success) echo livre; return;;
    failure) echo "esperar:@pos-migration da main VERMELHO (run $id) — reverter a PR culpada"; return;;
  esac
  # cancelado / pulado / estourou tempo: não é vermelho. A última migration da main já teve run verde?
  ult_mig=$(git log -1 --format=%H origin/main -- supabase/migrations)
  for h in $(api "repos/$REPO/actions/workflows/aceitacao-pos-migration.yml/runs?branch=main&status=success&per_page=30" --jq '.workflow_runs[].head_sha'); do
    git cat-file -e "$h^{commit}" 2> /dev/null || continue
    if [ -z "$ult_mig" ] || git merge-base --is-ancestor "$ult_mig" "$h"; then echo livre; return; fi
  done
  rerodar "$id" >&2
  echo "esperar:@pos-migration da main $conc (run $id) sem verde depois da última migration — re-rodando"
}

# Verificação de checks do commit de cabeça. Ecoa: ok | esperar:<motivo> | vermelho:<motivo>
estado_checks() {
  local sha=$1 so_docs=${2:-0} linhas pend verm canc acc vercel_ok vercel_ruim
  linhas=$(api "repos/$REPO/commits/$sha/check-runs?per_page=100" --paginate \
    --jq '.check_runs[] | select(.name != "fila") | [.name, .status, (.conclusion // "-"), .details_url] | @tsv')
  pend=$(awk -F'\t' '$2 != "completed" {print $1}' <<< "$linhas" | sort -u | paste -sd, -)
  verm=$(awk -F'\t' '$3 ~ /^(failure|timed_out|action_required|startup_failure|stale)$/ {print $1}' <<< "$linhas" | sort -u | paste -sd, -)
  canc=$(awk -F'\t' '$3 == "cancelled" {print $4}' <<< "$linhas" | sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p' | sort -u)
  [ -z "$verm" ] || { echo "vermelho:check vermelho: $verm"; return; }
  [ -z "$pend" ] || { echo "esperar:checks rodando: $pend"; return; }
  if [ -n "$canc" ]; then for id in $canc; do rerodar "$id" >&2; done; echo "esperar:check cancelado re-disparado"; return; fi
  # gates (scripts/gates/): saíram do build da Vercel para o workflow gates.yml (CEO 07/10) — têm de existir e estar verdes
  case "$(awk -F'\t' '$1 == "gates" {print $3}' <<< "$linhas" | tail -1)" in
    success) ;; '') echo "esperar:gates ainda não rodaram"; return;; *) echo "vermelho:gates não estão verdes"; return;;
  esac
  [ "$so_docs" = 1 ] && { echo ok; return; }
  # aceitação (preview): tem de existir e estar verde (ou dispensada pela triagem)
  acc=$(awk -F'\t' '$1 == "aceitacao" {print $3}' <<< "$linhas" | tail -1)
  case "$acc" in success|skipped|neutral) ;; '') echo "esperar:aceitação (preview) ainda não rodou"; return;; *) echo "vermelho:aceitação $acc"; return;; esac
  # Vercel (build do preview): status de commit ou check-run cujo nome começa com Vercel
  # build ignorado vem como success "Canceled by Ignored Build Step": conta como sem preview (pending)
  vercel_ok=$( { api "repos/$REPO/commits/$sha/status" --jq '.statuses[] | select(.context | startswith("Vercel"))
                   | if (.state == "success" and ((.description // "") | test("cancel|ignor"; "i"))) then "pending" else .state end'
                 awk -F'\t' '$1 ~ /^Vercel/ {print $3}' <<< "$linhas"; } | sort -u)
  vercel_ruim=$(grep -vE '^(success)$' <<< "$vercel_ok" | grep -v '^$' || true)
  [ -n "$vercel_ok" ] || { echo "esperar:Vercel ainda não respondeu"; return; }
  case "$vercel_ruim" in '') echo ok;; *pending*) echo "esperar:Vercel em andamento";; *) echo "vermelho:Vercel $vercel_ruim";; esac
}

# (c) autorização pelo conteúdo. Ecoa: ok | vermelho:<motivo>
autorizacao() {
  local n=$1 pid corpo pid_aut
  git fetch -q origin "pull/$n/head:refs/fila/pr-$n" --force
  pid=$(git diff "$(git merge-base origin/main "refs/fila/pr-$n")" "refs/fila/pr-$n" | git patch-id --stable | cut -d' ' -f1)
  corpo=$(api "repos/$REPO/issues/$n/comments" --paginate \
    --jq "[.[] | select(.body | test(\"MERGE AUTORIZADO #$n([^0-9]|\$)\"))] | last | .body // empty")
  [ -n "$corpo" ] || { echo "vermelho:PR sensível ($SENSIVEL) sem comentário \"MERGE AUTORIZADO #$n — gilberto-revisor · patch-id …\""; return; }
  pid_aut=$(grep -oE 'patch-id[: ]+[0-9a-f]{40}' <<< "$corpo" | tail -1 | grep -oE '[0-9a-f]{40}' || true)
  [ -n "$pid_aut" ] || { echo "vermelho:a autorização não traz patch-id — o revisor repete com \`scripts/merge/patch-id.sh $n\` (atual: $pid)"; return; }
  [ "$pid_aut" = "$pid" ] || { echo "vermelho:o conteúdo mudou depois da autorização (patch-id autorizado $pid_aut ≠ atual $pid) — exige nova revisão"; return; }
  echo ok
}

git fetch -q origin main
echo "## Fila de merge" >> "$SUMARIO"

# fila em ordem de entrada (hora da última label fila-merge)
fila=$(for n in $(api "repos/$REPO/issues?state=open&labels=$LABEL&per_page=100" --jq '.[] | select(.pull_request) | .number'); do
  t=$(api "repos/$REPO/issues/$n/events?per_page=100" --paginate \
      --jq ".[] | select(.event == \"labeled\" and .label.name == \"$LABEL\") | .created_at" | tail -1)
  echo "${t:-9999} $n"
done | sort | awk '{print $2}')
[ -n "$fila" ] || { log "fila vazia"; exit 0; }
log "fila: $(echo $fila | sed 's/\([0-9]*\)/#\1/g')"

so_sem_migration=0
for n in $fila; do
  pj=$(api "repos/$REPO/pulls/$n")
  [ "$(jq -r .mergeable <<< "$pj")" = null ] && { sleep 5; pj=$(api "repos/$REPO/pulls/$n"); }
  sha=$(jq -r .head.sha <<< "$pj"); titulo=$(jq -r .title <<< "$pj")
  [ "$(jq -r .draft <<< "$pj")" = false ] || { tirar_da_fila "$n" "está em rascunho (draft); a fila só aceita PR Ready"; continue; }
  [ "$(jq -r .base.ref <<< "$pj")" = main ] || { tirar_da_fila "$n" "a base não é a main"; continue; }
  [ "$(jq -r .head.repo.full_name <<< "$pj")" = "$REPO" ] || { tirar_da_fila "$n" "PR de fork não entra na fila"; continue; }
  [ "$(jq -r .mergeable <<< "$pj")" != false ] || { tirar_da_fila "$n" "conflito com a main (resolva com merge da main no ramo)"; continue; }

  com_migration=0; so_docs=0
  arquivos=$(api "repos/$REPO/pulls/$n/files" --paginate --jq '.[].filename')
  grep -q '^supabase/migrations/' <<< "$arquivos" && com_migration=1
  # mesma regra do scripts/vercel-ignore.mjs: sem preview para PR só de .md/docs/.github
  grep -qvE '(\.md$|^docs/|^\.github/)' <<< "$arquivos" || so_docs=1
  if [ "$so_sem_migration" = 1 ] && [ "$com_migration" = 1 ]; then log "#$n tem migration: espera a main (atrás da anterior)"; continue; fi

  # (c) sensível → autorização pelo conteúdo
  if jq -e --arg l "$SENSIVEL" '.labels | map(.name) | index($l)' <<< "$pj" > /dev/null; then
    a=$(autorizacao "$n")
    [ "$a" = ok ] || { tirar_da_fila "$n" "${a#vermelho:}"; continue; }
    log "#$n: autorização do gilberto-revisor confere com o conteúdo (patch-id)"
  fi

  # atrás da main → atualiza (merge da main no ramo, sem reescrever histórico) e espera os checks do novo commit
  atras=$(api "repos/$REPO/compare/main...$sha" --jq '.behind_by')
  if [ "$atras" -gt 0 ]; then
    if api -X PUT "repos/$REPO/pulls/$n/update-branch" -f expected_head_sha="$sha" > /dev/null 2>&1; then
      log "#$n estava $atras commit(s) atrás da main: atualizada; aguardando os checks do novo commit"
    else
      tirar_da_fila "$n" "não consegui atualizar com a main (conflito?)"; continue
    fi
    exit 0
  fi

  c=$(estado_checks "$sha" "$so_docs")
  case "$c" in
    vermelho:*) tirar_da_fila "$n" "${c#vermelho:} (commit ${sha:0:7})"; continue;;
    esperar:*) log "#$n aguardando: ${c#esperar:}"; exit 0;;
  esac

  # (b) só PR COM migration depende da main (deploy + @pos-migration)
  if [ "$com_migration" = 1 ]; then
    m=$(estado_main)
    if [ "$m" != livre ]; then
      log "#$n (com migration) aguardando a main: ${m#esperar:} — PRs sem migration atrás dela podem seguir"
      so_sem_migration=1; continue
    fi
  fi

  # merge travado no SHA conferido (se alguém empurrou no meio, o GitHub recusa)
  if out=$(api -X PUT "repos/$REPO/pulls/$n/merge" -f merge_method=squash -f sha="$sha" -f commit_title="$titulo (#$n)" 2>&1); then
    log "#$n MERGEADA (squash, ${sha:0:7})"
    comentar "$n" "✅ **Fila de merge:** mergeada (squash) no commit conferido \`${sha:0:7}\`.$([ "$com_migration" = 1 ] && echo ' Tem migration: veredito no @pos-migration da main (vermelho = reverter).')"
    exit 0
  fi
  tirar_da_fila "$n" "o GitHub recusou o merge: $(tr '\n' ' ' <<< "$out" | cut -c1-300)"
done
log "nenhuma PR pronta para merge nesta rodada"
