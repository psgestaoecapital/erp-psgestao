#!/usr/bin/env bash
# Fila de merge própria (CEO 06/10, regras a–d · erp_contexto_projeto 5c30d735). O merge queue do GitHub exige plano
# pago de organização (RD-42); esta fila é um workflow gratuito, acordado por EVENTOS (sem polling).
#
# Entra na fila (CEO 08/10 08:15, "ok fila sem etiqueta"): TODA PR aberta, NÃO-draft (Ready), base main, do próprio
# repositório, com todos os checks obrigatórios verdes. A label `fila-merge` virou OPCIONAL (continua aceita: a hora
# em que foi posta conta como entrada na fila). A label `nao-publicar` tira a PR da fila (a fila comenta o motivo UMA vez). Ordem: hora em que a PR
# entrou (label fila-merge; senão a última vez que ficou Ready; senão a criação). Por execução, no máximo 1 merge
# (squash, travado no SHA conferido); o push na main dispara a próxima rodada.
# SEM BLOQUEIO PELA CABEÇA (CEO 07/10): a PR que está atrás da main é atualizada (update-branch) e a PR cujos checks
# ainda rodam fica esperando — e a rodada SEGUE para a próxima PR da fila (antes saía e uma PR lenta segurava todas).
# Várias PRs podem ser atualizadas na mesma rodada. Migration: só a PR com migration que espera a MAIN (deploy-migrations
# ou @pos-migration da anterior, estado_main) segura as outras COM migration — uma migration por vez na main. PR com
# migration que espera os PRÓPRIOS checks ou foi atualizada NÃO segura ninguém (incidente 07/10: a #2118, via revisada
# esperando a aceitação, travou a #2133 e todas as PRs com migration por horas; o db push --include-all não exige ordem).
#
#   (a) run CANCELADO do @pos-migration não é vermelho: re-roda; se a última migration da main já teve run verde, libera.
#   (b) PR SEM migration não espera o @pos-migration: exige checks verdes + gates + Vercel + aceitação (preview).
#       PR só de .md/docs/.github não tem preview (Ignored Build Step, CEO 07/10): exige só os checks + gates.
#   (c) PR sensível (label revisao-eng-chefe) exige "MERGE AUTORIZADO #N — gilberto-revisor · patch-id <hex>" com o
#       patch-id do CONTEÚDO atual (scripts/merge/patch-id.sh). Atualizar com a main mantém; mudar o código derruba.
#   (e) ESTEIRA EM 2 VELOCIDADES (CEO 07/10 08:05 — TEMPORÁRIA, até haver um banco de testes por vaga):
#       VIA RÁPIDA  = PR SEM a label revisao-eng-chefe: checks rápidos + preview (Vercel, build real) verdes; a
#                     aceitação (checks aceitacao/triagem/@pos-migration informativo) é só informativa — não entra
#                     em pendente/vermelho/cancelado e não é exigida. A aceitação da main roda de hora em hora
#                     (aceitacao-main.yml, banco de testes): vermelho = corrigir em 1 h ou reverter.
#       VIA REVISADA = PR COM revisao-eng-chefe: aceitação verde + MERGE AUTORIZADO pelo patch-id (como antes).
#   (d) vermelho de verdade (conflito, check falho, autorização inválida) → comenta o motivo UMA vez por commit (marca
#       escondida no comentário) e tira a label se houver; a PR volta a ser avaliada sozinha no próximo commit.
#
# Uso: GH_TOKEN=<PAT> REPO=dono/repo scripts/merge/fila-merge.sh   (num checkout da main com histórico completo)
# GH_TOKEN precisa ser um PAT: merge feito com o GITHUB_TOKEN NÃO dispara o deploy-migrations na main.
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN (PAT) ausente}" "${REPO:?REPO ausente}"
LABEL='fila-merge'
NAO_PUBLICAR='nao-publicar'
SENSIVEL=revisao-eng-chefe
RODAPE=$'\n\n<sub>fila-merge · '"${RUN_URL:-local}"'</sub>'
SUMARIO="${GITHUB_STEP_SUMMARY:-/dev/null}"

api() { gh api -H 'Accept: application/vnd.github+json' "$@"; }
log() { echo "$*"; echo "- $*" >> "$SUMARIO"; }
comentar() { api -X POST "repos/$REPO/issues/$1/comments" -f body="$2$RODAPE" > /dev/null; }
# comentários da PR lidos UMA vez por rodada (cada corpo numa linha, em JSON) — a fila agora olha todas as PRs Ready
TMPF=$(mktemp -d); trap 'rm -rf "$TMPF"' EXIT
comentarios() {
  [ -f "$TMPF/c-$1" ] || api "repos/$REPO/issues/$1/comments" --paginate --jq '.[].body | @json' > "$TMPF/c-$1"
  cat "$TMPF/c-$1"
}
# comenta só se a marca escondida <!-- fila:CHAVE --> ainda não está na PR (a fila roda a cada evento: sem spam)
comentar_uma_vez() {
  local n=$1 chave=$2 texto=$3
  if comentarios "$n" | grep -qF "<!-- fila:$chave -->"; then return 0; fi
  comentar "$n" "$texto
<!-- fila:$chave -->"
  printf '%s\n' "\"<!-- fila:$chave -->\"" >> "$TMPF/c-$n"
}
# vermelho de verdade: comenta o motivo uma vez por commit + motivo e tira a label (se houver). Sem a label a PR
# continua candidata (a etiqueta é opcional): volta a ser avaliada sozinha no próximo commit.
tirar_da_fila() {
  local n=$1 motivo=$2 sha=${3:-} chave
  chave="v-${sha:0:12}-$(printf '%s' "$motivo" | md5sum | cut -c1-8)"
  log "#$n fora desta rodada: $motivo"
  comentar_uma_vez "$n" "$chave" "🚫 **Fila de merge:** #$n não foi publicada — $motivo

Corrija e empurre o commit: a fila avalia de novo sozinha (a label \`$LABEL\` é opcional). Para a fila ignorar esta PR, use a label \`$NAO_PUBLICAR\`."
  api -X DELETE "repos/$REPO/issues/$n/labels/$LABEL" > /dev/null 2>&1 || true
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

# checks da aceitação: na VIA RÁPIDA são só informativos (não contam e não são exigidos)
ACEITACAO_INFORMATIVA='^(aceitacao|triagem|@pos-migration [(]informativo[)])$'

# Verificação de checks do commit de cabeça. $2 = rapida | revisada. Ecoa: ok | esperar:<motivo> | vermelho:<motivo>
estado_checks() {
  local sha=$1 via=${2:-revisada} so_docs=${3:-0} linhas pend verm canc acc vercel_ok vercel_ruim
  linhas=$(api "repos/$REPO/commits/$sha/check-runs?per_page=100" --paginate \
    --jq '.check_runs[] | select(.name != "fila") | [.name, .status, (.conclusion // "-"), .details_url] | @tsv')
  # via rápida: tira a aceitação do cálculo de pendentes, vermelhos e cancelados
  [ "$via" = rapida ] && linhas=$(awk -F'\t' -v re="$ACEITACAO_INFORMATIVA" '$1 !~ re' <<< "$linhas")
  pend=$(awk -F'\t' '$2 != "completed" {print $1}' <<< "$linhas" | sort -u | paste -sd, -)
  verm=$(awk -F'\t' '$3 ~ /^(failure|timed_out|action_required|startup_failure|stale)$/ {print $1}' <<< "$linhas" | sort -u | paste -sd, -)
  canc=$(awk -F'\t' '$3 == "cancelled" {print $4}' <<< "$linhas" | sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p' | sort -u)
  [ -z "$verm" ] || { echo "vermelho:check vermelho: $verm"; return; }
  [ -z "$pend" ] || { echo "esperar:checks rodando: $pend"; return; }
  if [ -n "$canc" ]; then for id in $canc; do rerodar "$id" >&2; done; echo "esperar:check cancelado re-disparado"; return; fi
  # gates (scripts/gates/): saíram do build da Vercel para o workflow gates.yml (CEO 07/10) — têm de existir e estar
  # verdes nas DUAS vias
  case "$(awk -F'\t' '$1 == "gates" {print $3}' <<< "$linhas" | tail -1)" in
    success) ;; '') echo "esperar:gates ainda não rodaram"; return;; *) echo "vermelho:gates não estão verdes"; return;;
  esac
  # PR só de .md/docs/.github não tem preview nem aceitação (Ignored Build Step): basta checks + gates
  [ "$so_docs" = 1 ] && { echo ok; return; }
  # aceitação (preview): na via REVISADA tem de existir e estar verde (ou dispensada pela triagem)
  if [ "$via" = revisada ]; then
    acc=$(awk -F'\t' '$1 == "aceitacao" {print $3}' <<< "$linhas" | tail -1)
    case "$acc" in success|skipped|neutral) ;; '') echo "esperar:aceitação (preview) ainda não rodou"; return;; *) echo "vermelho:aceitação $acc"; return;; esac
  fi
  # Vercel (preview): status de commit ou check-run cujo nome começa com Vercel — só build REAL conta como verde
  # (build pulado aparece como success "Canceled by Ignored Build Step": conta como pendente)
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
  # só vale comentário cuja PRIMEIRA linha é exatamente a autorização do revisor; aviso da fila (marca escondida ou
  # "Fila de merge:") cita o texto mas nunca conta (todos os comentários saem da mesma conta do GitHub)
  corpo=$(comentarios "$n" | jq -rs --arg re "^MERGE AUTORIZADO #$n — gilberto-revisor · patch-id [0-9a-f]{40}([ \\t\\r]*|[:\\s].*)\$" \
    '[.[] | select((contains("<!-- fila:") | not) and (startswith("Fila de merge:") | not) and (split("\n")[0] | test($re)))] | last // empty | split("\n")[0]')
  [ -n "$corpo" ] || { echo "vermelho:PR sensível ($SENSIVEL) sem a autorização do revisor para o conteúdo atual"; return; }
  pid_aut=$(grep -oE 'patch-id[: ]+[0-9a-f]{40}' <<< "$corpo" | tail -1 | grep -oE '[0-9a-f]{40}' || true)
  [ -n "$pid_aut" ] || { echo "vermelho:a autorização do revisor não traz o identificador do conteúdo — o revisor repete após rodar \`scripts/merge/patch-id.sh $n\`"; return; }
  [ "$pid_aut" = "$pid" ] || { echo "vermelho:o conteúdo mudou depois da autorização do revisor — exige nova revisão"; return; }
  echo ok
}

git fetch -q origin main
echo "## Fila de merge" >> "$SUMARIO"

# Válvula da cota da API (CEO 08/10): a fila agora olha TODAS as PRs Ready a cada rodada e o mesmo PAT serve o
# /re-rodar e o vigia. Com pouca cota, a rodada não roda (o próximo evento depois da renovação retoma) — nunca esgota.
COTA_MINIMA=${COTA_MINIMA:-1000}
cota=$(api rate_limit --jq '.resources.core.remaining' 2> /dev/null || echo 99999)
if [ "${cota:-0}" -lt "$COTA_MINIMA" ]; then log "cota da API baixa ($cota < $COTA_MINIMA): rodada adiada até a renovação"; exit 0; fi

# candidatas: TODA PR aberta, não-draft, na main, do próprio repositório (a label fila-merge é opcional). Draft e PR de
# outro repositório ficam de fora em silêncio. Ordem de entrada: label fila-merge; senão a última vez que ficou Ready;
# senão a criação da PR.
# A lista já traz draft, labels, SHA e título: sem uma chamada por PR para isso (cota da API).
api "repos/$REPO/pulls?state=open&base=main&per_page=100" --paginate \
    --jq ".[] | select(.draft == false and .head.repo.full_name == \"$REPO\") | tojson" > "$TMPF/lista"
fila=$(while read -r linha; do
    n=$(jq -r .number <<< "$linha"); t=
    if jq -e --arg l "$LABEL" '.labels | map(.name) | index($l)' <<< "$linha" > /dev/null; then
      t=$(api "repos/$REPO/issues/$n/events?per_page=100" --paginate \
          --jq ".[] | select(.event == \"labeled\" and .label.name == \"$LABEL\") | .created_at" | tail -1)
    fi
    echo "${t:-$(jq -r .created_at <<< "$linha")} $n"
  done < "$TMPF/lista" | sort | awk '{print $2}')
[ -n "$fila" ] || { log "fila vazia"; exit 0; }
log "fila: $(echo $fila | sed 's/\([0-9]*\)/#\1/g')"

# próxima versão de migration > $1 (piso), com os 2 últimos dígitos $2 (faixa do agente); timestamp do momento (UTC)
proxima_versao() {
  local piso=$1 ss=$2 t cand
  t=$(date -u +%s)
  while :; do
    cand="$(date -u -d "@$t" +%Y%m%d%H%M)$ss"
    [ "$cand" -gt "$piso" ] && break
    t=$((t + 60))
  done
  echo "$cand"
}

# Renomeia (commit no ramo da PR, pela API de conteúdo) as migrations NOVAS da PR com versão <= a última da main.
# Retorna 0 se renumerou (a PR segue no próximo commit) e 1 se não pôde (quem chama recusa como antes). Não renumera se
# outro arquivo da PR cita a versão antiga (gate/spec que lê a migration pelo nome): aí a decisão é de quem fez a PR.
renumerar_migrations() {
  local n=$1 pj=$2 ult=$3 baixas=$4 via=$5 ref piso f v rest novo c b64 fsha lista=''
  ref=$(jq -r .head.ref <<< "$pj"); piso=$ult
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    v=${f:0:14}
    if api "repos/$REPO/pulls/$n/files" --paginate | jq -e --arg v "$v" --arg f "supabase/migrations/$f" '.[] | select(.filename != $f and ((.patch // "") | contains($v)))' > /dev/null; then
      log "#$n: outro arquivo da PR cita a versão $v: não renumero sozinha"; return 1
    fi
  done <<< "$baixas"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    v=${f:0:14}; rest=${f:15}
    novo=$(proxima_versao "$piso" "${v:12:2}"); piso=$novo
    c=$(api "repos/$REPO/contents/supabase/migrations/$f?ref=$ref") || return 1
    b64=$(jq -r .content <<< "$c" | tr -d '\n'); fsha=$(jq -r .sha <<< "$c")
    { [ -n "$b64" ] && [ "$fsha" != null ]; } || return 1
    api -X PUT "repos/$REPO/contents/supabase/migrations/${novo}_$rest" -f message="fila: renumera migration $v para $novo (acima da última da main $ult)" -f content="$b64" -f branch="$ref" > /dev/null || return 1
    api -X DELETE "repos/$REPO/contents/supabase/migrations/$f" -f message="fila: remove migration $v (renumerada para $novo)" -f sha="$fsha" -f branch="$ref" > /dev/null || return 1
    lista="$lista
- \`${v}_$rest\` → \`${novo}_$rest\`"
  done <<< "$baixas"
  log "#$n: migration(s) renumerada(s) pela fila"
  comentar "$n" "🔢 **Fila de merge:** a migration desta PR estava com versão NÃO maior que a última da main (\`$ult\`); renumerei sozinha (commit no ramo, conteúdo idêntico):$lista

Os checks rodam de novo no commit novo.$([ "$via" = revisada ] && echo " **Via revisada: o patch-id mudou — o gilberto-revisor precisa autorizar de novo (a etiqueta \`$SENSIVEL\` é tirada e recolocada para acordá-lo).")"
  if [ "$via" = revisada ]; then
    api -X DELETE "repos/$REPO/issues/$n/labels/$SENSIVEL" > /dev/null 2>&1 || true
    api -X POST "repos/$REPO/issues/$n/labels" -f "labels[]=$SENSIVEL" > /dev/null 2>&1 || true
  fi
  return 0
}

so_sem_migration=0
# Teto de PRs "da vez" em PREPARO ao mesmo tempo (CEO 09/10): atualizar com a main dispara preview/aceitação (~3 min/PR).
# Sem teto, a fila atualizava TODA PR verde atrás da main a cada push → dezenas de builds por publicação. Agora prepara só
# as próximas N da ordem; as demais esperam a vez (sem build) até uma da frente mergear. NÃO muda quem mergeia (1/rodada).
ATUALIZA_NA_VEZ=${ATUALIZA_NA_VEZ:-2}
em_preparo=0
for n in $fila; do
  pj=$(jq -c --argjson n "$n" 'select(.number == $n)' "$TMPF/lista")
  sha=$(jq -r .head.sha <<< "$pj"); titulo=$(jq -r .title <<< "$pj")
  # draft (pode ter virado draft depois da lista), outra base ou fork: fora, em silêncio
  [ "$(jq -r .draft <<< "$pj")" = false ] || { log "#$n é rascunho (draft): fora da fila"; continue; }
  [ "$(jq -r .base.ref <<< "$pj")" = main ] || { log "#$n não é para a main: fora da fila"; continue; }
  [ "$(jq -r .head.repo.full_name <<< "$pj")" = "$REPO" ] || { log "#$n é de fork: fora da fila"; continue; }
  # nao-publicar: a fila pula a PR e avisa UMA vez (CEO 08/10)
  if jq -e --arg l "$NAO_PUBLICAR" '.labels | map(.name) | index($l)' <<< "$pj" > /dev/null; then
    log "#$n tem a label $NAO_PUBLICAR: pulada"
    comentar_uma_vez "$n" "$NAO_PUBLICAR" "⏸️ **Fila de merge:** #$n tem a label \`$NAO_PUBLICAR\` — a fila não publica esta PR. Tire a label quando ela puder ser publicada."
    continue
  fi
  # conflito: a lista não traz o mergeable; aparece no update-branch (PR atrás da main) ou na recusa do merge

  com_migration=0; so_docs=0
  arquivos=$(api "repos/$REPO/pulls/$n/files" --paginate --jq '.[].filename')
  grep -q '^supabase/migrations/' <<< "$arquivos" && com_migration=1
  # mesma regra do scripts/vercel-ignore.mjs: sem preview para PR só de .md/docs/.github
  grep -qvE '(\.md$|^docs/|^\.github/)' <<< "$arquivos" || so_docs=1
  if [ "$so_sem_migration" = 1 ] && [ "$com_migration" = 1 ]; then log "#$n tem migration: espera a main (atrás da anterior)"; continue; fi

  # (e) via: COM revisao-eng-chefe = revisada (aceitação + autorização); SEM = rápida (aceitação informativa)
  via=rapida
  jq -e --arg l "$SENSIVEL" '.labels | map(.name) | index($l)' <<< "$pj" > /dev/null && via=revisada
  log "#$n segue a $([ "$via" = rapida ] && echo 'via rápida (checks + preview; aceitação informativa)' || echo 'via revisada (aceitação verde + MERGE AUTORIZADO)')"

  # (c) sensível → autorização pelo conteúdo
  if [ "$via" = revisada ]; then
    a=$(autorizacao "$n")
    [ "$a" = ok ] || { tirar_da_fila "$n" "${a#vermelho:}" "$sha"; continue; }
    log "#$n: autorização do gilberto-revisor confere com o conteúdo (patch-id)"
  fi

  # checks ANTES de atualizar com a main (CEO 08/10, fila sem etiqueta): só a PR verde é atualizada — a vermelha
  # recebe o aviso e fica como está (sem empurrar merge da main no ramo de quem ainda não acabou a PR).
  c=$(estado_checks "$sha" "$via" "$so_docs")
  case "$c" in
    vermelho:*) tirar_da_fila "$n" "${c#vermelho:} (commit ${sha:0:7})" "$sha"; continue;;
    esperar:*) [ "${c#esperar:}" = 'gates ainda não rodaram' ] || em_preparo=$((em_preparo + 1)); log "#$n aguardando: ${c#esperar:} — segue para a próxima"; continue;;
  esac

  # atrás da main → atualiza (merge da main no ramo, sem reescrever histórico), MAS só as próximas ATUALIZA_NA_VEZ da
  # ordem; as demais esperam a vez (sem disparar preview/aceitação agora). Cada publicação gera ~N builds, não um por PR.
  atras=$(api "repos/$REPO/compare/main...$sha" --jq '.behind_by')
  if [ "$atras" -gt 0 ]; then
    if [ "$em_preparo" -ge "$ATUALIZA_NA_VEZ" ]; then
      log "#$n está $atras atrás da main, mas já há $em_preparo PR(s) da vez em preparo (teto $ATUALIZA_NA_VEZ): espera a vez — sem build agora"; continue
    fi
    em_preparo=$((em_preparo + 1))
    if api -X PUT "repos/$REPO/pulls/$n/update-branch" -f expected_head_sha="$sha" > /dev/null 2>&1; then
      log "#$n estava $atras commit(s) atrás da main: atualizada (vaga $em_preparo/$ATUALIZA_NA_VEZ); aguardando os checks do novo commit — segue para a próxima"
    else
      tirar_da_fila "$n" "não consegui atualizar com a main (conflito?)" "$sha"; continue
    fi
    continue
  fi

  # (b) só PR COM migration depende da main (deploy + @pos-migration)
  if [ "$com_migration" = 1 ]; then
    m=$(estado_main)
    if [ "$m" != livre ]; then
      log "#$n (com migration) aguardando a main: ${m#esperar:} — PRs sem migration atrás dela podem seguir"
      so_sem_migration=1; continue
    fi
    # Régua de versão NA HORA do merge (incidente 08/10: #2239 entrou com 20261008140005 abaixo da 150005 já aplicada e o
    # `db push` recusou — deploy vermelho por horas). Recalcula a última migration da main agora (não usa o check antigo
    # da PR). Com o deploy-migrations verde (estado_main livre), a última da main = a última aplicada em produção.
    ult_main=$(api "repos/$REPO/git/trees/main:supabase/migrations" | jq -r '[.tree[].path | select(test("^[0-9]{14}_")) | .[0:14]] | max')
    baixas=$(api "repos/$REPO/pulls/$n/files" --paginate | jq -r --arg u "$ult_main" '.[] | select(.status == "added" and (.filename | test("^supabase/migrations/[0-9]{14}_"))) | .filename | ltrimstr("supabase/migrations/") | select(.[0:14] <= $u)')
    if [ -n "$baixas" ]; then
      # Renumeração AUTOMÁTICA (Eng. Chefe 09/10): em vez de recusar, a fila renomeia a(s) migration(s) da PR com um commit
      # no ramo dela (versão nova = timestamp do momento, mantendo os 2 últimos dígitos = faixa do agente). O commit roda
      # os checks de novo; PR revisada precisa de NOVA autorização do revisor (o patch-id muda).
      if renumerar_migrations "$n" "$pj" "$ult_main" "$baixas" "$via"; then continue; fi
      tirar_da_fila "$n" "migration com versão NÃO maior que a última da main ($ult_main): $(tr '\n' ' ' <<< "$baixas") — não consegui renumerar sozinha; renumere para uma versão acima e atualize com a main (o db push recusa versão abaixo da última aplicada)" "$sha"; continue
    fi
  fi

  # merge travado no SHA conferido (se alguém empurrou no meio, o GitHub recusa)
  if out=$(api -X PUT "repos/$REPO/pulls/$n/merge" -f merge_method=squash -f sha="$sha" -f commit_title="$titulo (#$n)" 2>&1); then
    log "#$n MERGEADA (squash, ${sha:0:7}) pela via $([ "$via" = rapida ] && echo rápida || echo revisada)"
    comentar "$n" "✅ **Fila de merge:** mergeada (squash) no commit conferido \`${sha:0:7}\` pela **via $([ "$via" = rapida ] && echo 'rápida** (aceitação informativa; a aceitação da main roda de hora em hora)' || echo 'revisada**').$([ "$com_migration" = 1 ] && echo ' Tem migration: veredito no @pos-migration da main (vermelho = reverter).')"
    exit 0
  fi
  tirar_da_fila "$n" "o GitHub recusou o merge: $(tr '\n' ' ' <<< "$out" | cut -c1-300)" "$sha"
done
log "nenhuma PR pronta para merge nesta rodada"
