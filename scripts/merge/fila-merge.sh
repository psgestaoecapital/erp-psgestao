#!/usr/bin/env bash
# Fila de merge própria (CEO 06/10, regras a–d · erp_contexto_projeto 5c30d735). O merge queue do GitHub exige plano
# pago de organização (RD-42); esta fila é um workflow gratuito, acordado por EVENTOS (sem polling).
#
# Entra na fila (CEO 08/10 08:15, "ok fila sem etiqueta"): TODA PR aberta, NÃO-draft (Ready), base main, do próprio
# repositório, com todos os checks obrigatórios verdes. A label `fila-merge` virou OPCIONAL (continua aceita: a hora
# em que foi posta conta como entrada na fila). A label `nao-publicar` tira a PR da fila (a fila comenta o motivo UMA vez). Ordem: hora em que a PR
# entrou (label fila-merge; senão a última vez que ficou Ready; senão a criação). LOTE (CEO 09/10): numa mesma rodada a
# fila publica VÁRIAS PRs SEM migration (squash, cada uma travada no seu SHA conferido), até o teto LOTE_MAX; PR COM
# migration é sempre UMA por rodada e encerra a rodada (a próxima espera o deploy + @pos-migration da main). O `atras` é
# medido contra a main do INÍCIO da rodada (MAIN0): uma PR em dia no começo segue publicável mesmo depois de a fila ter
# mergeado outras à frente dela nesta rodada (sem rebuild só porque a main andou no próprio lote).
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
# shellcheck source=scripts/merge/patch-id-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/patch-id-lib.sh"
: "${GH_TOKEN:?GH_TOKEN (PAT) ausente}" "${REPO:?REPO ausente}"
LABEL='fila-merge'
NAO_PUBLICAR='nao-publicar'
SENSIVEL=revisao-eng-chefe
RODAPE=$'\n\n<sub>fila-merge · '"${RUN_URL:-local}"'</sub>'
SUMARIO="${GITHUB_STEP_SUMMARY:-/dev/null}"

# Leitura (GET, sem -X) tenta até 3x: resposta vazia/transitória da API ("unexpected end of JSON input") derrubava a rodada
# inteira (set -e) e deixava a esteira parada (runs 14909/14916, 14/10). Escrita (-X) NUNCA repete: não é idempotente.
api() {
  local t=1 out
  case " $* " in *" -X "*) gh api -H 'Accept: application/vnd.github+json' "$@"; return;; esac
  until out=$(gh api -H 'Accept: application/vnd.github+json' "$@"); do
    [ "$t" -ge 3 ] && return 1
    sleep $((t * 2)); t=$((t + 1))
  done
  [ -z "$out" ] || printf '%s\n' "$out"
}
# Observabilidade (CEO 10/10): toda linha "#<pr> ..." também vai p/ o snapshot que a fila grava no fim (flush_estado).
log() { echo "$*"; echo "- $*" >> "$SUMARIO"; case "$*" in \#[0-9]*) [ -n "${TMPF:-}" ] && printf '%s\n' "$*" >> "$TMPF/estado" 2>/dev/null || true;; esac; }
# Grava "por que cada PR está presa" em erp_esteira_pr_estado (a aba /dashboard/dev lê). No trap EXIT: roda sempre, mesmo
# quando a rodada encerra num `exit 0` após um merge. Guardado: sem SUPABASE_URL/SERVICE_KEY, é no-op (nunca quebra a fila).
flush_estado() {
  [ -n "${TMPF:-}" ] && [ -f "$TMPF/estado" ] || return 0
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || return 0
  local payload
  payload=$(ESTADO_FILE="$TMPF/estado" RUN_URL="${RUN_URL:-}" python3 scripts/merge/esteira-estado-json.py 2>/dev/null) || return 0
  [ -n "$payload" ] || return 0
  curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/fn_esteira_pr_estado_gravar" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 || true
}
# Comentário é informativo: falha (ex.: rate limit secundário, 403, 12/10) NUNCA derruba a rodada — senão a fila morre no
# meio e as PRs seguintes não são avaliadas nem publicadas. Sempre retorna 0; COMENTOU=0 sinaliza a falha ao
# comentar_uma_vez (que então não marca como "já comentado" e tenta de novo na próxima rodada).
COMENTOU=1
comentar() {
  if api -X POST "repos/$REPO/issues/$1/comments" -f body="$2$RODAPE" > /dev/null 2>&1; then COMENTOU=1
  else COMENTOU=0; echo "::warning::fila: comentário na #$1 falhou (rate limit?) — segue a rodada"; fi
  return 0
}
# comentários da PR lidos UMA vez por rodada (cada corpo numa linha, em JSON) — a fila agora olha todas as PRs Ready
TMPF=$(mktemp -d); trap 'flush_estado; rm -rf "$TMPF"' EXIT
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
  [ "$COMENTOU" = 1 ] || return 0
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
  else log "run $id já teve $tent tentativas: não re-roda de novo (avise o Eng. Chefe)"; return 1; fi
}

# Janela temporária do @pos-migration por LINHA-DE-BASE (CEO 15/10, contexto e89e0d62, com o CEO presente): até
# 2026-10-17 11:00 America/Sao_Paulo (= 2026-10-17T14:00:00Z), o @pos-migration da main VERMELHO só BLOQUEIA a PR COM
# migration se houver falha NOVA — um spec fora da LINHA-DE-BASE (os specs que falharam no run #496 da aceitação @pos,
# às 10:19 BRT de 15/10, antes das PRs do Hub). Mesma lista (ou subconjunto) → segue publicando (1 migration/rodada).
# Spec novo → bloqueia, comenta na PR que entrou por último e propõe reversão ao Eng. Chefe. Depois do limite, qualquer
# vermelho volta a bloquear sozinho. FILA_AGORA_EPOCH (o mesmo da janela da aceitação) deixa o gate provar os dois lados.
JANELA_POS_BASELINE_FIM='2026-10-17T14:00:00Z'
pos_baseline_ativa() { [ "${FILA_AGORA_EPOCH:-$(date -u +%s)}" -lt "$(date -u -d "$JANELA_POS_BASELINE_FIM" +%s)" ]; }
# Linha-de-base: specs que falharam no run #496 do "Aceitação @pos-migration (produção)" (run 38741770350, head
# 01a39b72, 2026-10-15T13:19:51Z). Provado no log do job falho (RD-38). FILA_POS_BASELINE sobrescreve (para o gate).
POS_BASELINE_496=${FILA_POS_BASELINE:-'e2e/jornadas/aceitacao/atak-status-equipe-rls.spec.ts
e2e/jornadas/aceitacao/pauta-p2.spec.ts'}
# specs que falharam num run @pos: pelas ANOTAÇÕES do check-run do job falho (CEO 15/10 17:50). O id do job É o id do
# check-run; `check-runs/<id>/annotations` NÃO baixa o log do job (que dá 404 com o token da integração/PAT). Pega os
# e2e/.../*.spec.ts das anotações de FALHA (campo path + título + mensagem) e do resumo "🎭 Playwright Run Summary".
# Um por linha, ordenado e único.
pos_specs_falhos() {
  local run=$1 jid
  for jid in $(api "repos/$REPO/actions/runs/$run/jobs" --jq '.jobs[] | select(.conclusion=="failure") | .id' 2>/dev/null); do
    api "repos/$REPO/check-runs/$jid/annotations" --paginate \
      --jq '.[] | select(.annotation_level == "failure" or ((.title // "") | test("Playwright Run Summary"))) | (.path // ""), (.title // ""), (.message // "")' 2>/dev/null
  done | grep -oE 'e2e/[A-Za-z0-9_./-]+\.spec\.ts' | sort -u
}
# Arquivos de teste (e2e/**/*.spec.ts) que a PR criou ou alterou (não os removidos). Um por linha, ordenado e único.
pr_specs_proprios() {
  api "repos/$REPO/pulls/$1/files" --paginate --jq '.[] | select(.status != "removed") | .filename' 2>/dev/null \
    | grep -E '^e2e/.*\.spec\.ts$' | sort -u
}

# Parte 2 (CEO 16/10): aciona AUTOMATICAMENTE o Code autor da PR (erp_dev_entrega.code) com o spec e o erro, sem esperar
# triagem — via fn_agente_mensagem_enviar (conexão de serviço). No-op sem SUPABASE_URL/SERVICE_KEY (nunca quebra a fila).
# Envia como de='eng_chefe' (quem despacha tarefa) com enviado_por='fila-merge' no rastro; tipo 'tarefa' aciona a rotina do Code.
acionar_autor_pos() {
  local pr=$1 novos=$2 run=$3 code assunto corpo
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || return 0
  code=$(curl -fsS "$SUPABASE_URL/rest/v1/erp_dev_entrega?pr_numero=eq.$pr&select=code&order=criado_em.desc&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null \
    | jq -r '.[0].code // empty' 2>/dev/null)
  [ -n "$code" ] || { log "@pos: PR #$pr sem Code em erp_dev_entrega — não dá para acionar o autor automaticamente (Eng. Chefe, acione à mão)"; return 0; }
  assunto="@pos vermelho: spec da sua PR #$pr falhou na main (run $run)"
  corpo="A fila detectou falha NOVA no @pos-migration da main (run $run), fora da linha-de-base do #496, logo após a publicação da PR #$pr (sua). Spec(s) que falhou(aram): $(tr '\n' ' ' <<< "$novos"). Investigue e corrija ou reverta o quanto antes — as PRs COM migration ficam seguras até o @pos voltar ao verde. Run: https://github.com/$REPO/actions/runs/$run"
  if curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/fn_agente_mensagem_enviar" \
       -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
       -d "$(jq -nc --arg para "$code" --arg assunto "$assunto" --arg corpo "$corpo" --arg ep "fila-merge · acionamento automático (@pos run $run)" \
             '{p_para:$para, p_de:"eng_chefe", p_tipo:"tarefa", p_assunto:$assunto, p_corpo:$corpo, p_requer_ok_ceo:false, p_enviado_por:$ep}')" \
       >/dev/null 2>&1; then
    log "@pos: Code $code acionado automaticamente (tarefa) para a falha NOVA da PR #$pr"
  else
    log "@pos: NÃO consegui acionar o Code $code (fn_agente_mensagem_enviar falhou) — Eng. Chefe, acione à mão a PR #$pr"
  fi
}

# Escala uma falha NOVA do @pos (dentro da janela): comenta UMA vez na PR do head do run @pos (a que entrou por último),
# propõe reversão ao Eng. Chefe E aciona o Code autor (Parte 2, CEO 16/10). Sem PR associada, só loga.
escalar_pos_novo() {
  local run=$1 novos=$2 hsha pr
  hsha=$(api "repos/$REPO/actions/runs/$run" --jq '.head_sha' 2>/dev/null)
  pr=$(api "repos/$REPO/commits/$hsha/pulls" --jq '.[0].number' 2>/dev/null || true)
  { [ -n "$pr" ] && [ "$pr" != null ]; } || { log "@pos falha NOVA ($(tr '\n' ' ' <<< "$novos"), run $run) sem PR no head $hsha — Eng. Chefe, reverter manualmente"; return; }
  # uma vez por run: a marca escondida controla comentário E acionamento (não reenvia tarefa a cada rodada)
  comentarios "$pr" | grep -qF "<!-- fila:pos-novo-$run -->" && return 0
  comentar "$pr" "🔴 **Fila de merge — Eng. Chefe:** o \`@pos-migration\` da main está VERMELHO com **falha NOVA** fora da linha-de-base do run #496 (janela temporária CEO 15/10): \`$(tr '\n' ' ' <<< "$novos")\` (run $run). Como esta PR entrou por último, a **proposta é revertê-la**. Enquanto não resolver, as PRs COM migration ficam seguras (as SEM migration seguem). O Code autor foi acionado automaticamente.
<!-- fila:pos-novo-$run -->"
  [ "$COMENTOU" = 1 ] || return 0   # comentário falhou (rate limit): não registra nem aciona; tenta tudo de novo na próxima rodada
  printf '%s\n' "\"<!-- fila:pos-novo-$run -->\"" >> "$TMPF/c-$pr"
  acionar_autor_pos "$pr" "$novos" "$run"
}

# (a) Estado da main para PR COM migration. Ecoa: livre | esperar:<motivo>
estado_main() {
  local ult_mig r st conc id falhos novos
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
    failure)
      # Janela CEO 15/10: vermelho só bloqueia se houver falha NOVA fora da linha-de-base do #496.
      if pos_baseline_ativa; then
        falhos=$(pos_specs_falhos "$id")
        if [ -n "$falhos" ]; then
          novos=$(comm -23 <(printf '%s\n' "$falhos") <(printf '%s\n' "$POS_BASELINE_496" | sed '/^$/d' | sort -u))
          if [ -z "$novos" ]; then
            log "@pos da main VERMELHO (run $id) só com falhas da linha-de-base do #496 (janela CEO 15/10): migration liberada" >&2
            echo livre; return
          fi
          escalar_pos_novo "$id" "$novos" >&2
          echo "esperar:@pos da main VERMELHO com falha NOVA fora da linha-de-base ($(tr '\n' ' ' <<< "$novos"), run $id) — reverter a última PR"; return
        fi
        # vermelho sem spec de teste identificado (falha de infra/ambiente): fail-closed, bloqueia
        echo "esperar:@pos da main VERMELHO sem spec de teste identificado (run $id) — bloqueia (janela CEO 15/10)"; return
      fi
      echo "esperar:@pos-migration da main VERMELHO (run $id) — reverter a PR culpada"; return;;
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

# (a2) Deadlock do deploy vermelho (Eng. Chefe 14/10, #2542): o deploy-migrations da main quebrou numa migration; a PR que a
# CONSERTA também tem migration e esperaria o deploy ficar verde — que só fica verde com ela. Exceção estreita: a main está
# com o deploy VERMELHO (completed/failure) e TODA migration da PR é um arquivo MODIFICADO (nenhuma adicionada) que o
# commit do run vermelho trouxe. Sem versão nova, a régua de versão não se aplica. Ecoa 1 (é o conserto) ou 0.
corrige_deploy_vermelho() {
  local n=$1 r st conc hsha mods quebrados f
  r=$(api "repos/$REPO/actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=1" --jq '.workflow_runs[0] | "\(.status) \(.conclusion) \(.head_sha)"')
  read -r st conc hsha <<< "$r"
  { [ "$st" = completed ] && [ "$conc" = failure ] && [ -n "$hsha" ]; } || { echo 0; return; }
  mods=$(api "repos/$REPO/pulls/$n/files" --paginate --jq '.[] | select(.filename | startswith("supabase/migrations/")) | "\(.status) \(.filename)"')
  [ -n "$mods" ] || { echo 0; return; }
  grep -qv '^modified ' <<< "$mods" && { echo 0; return; }
  quebrados=$(api "repos/$REPO/commits/$hsha" --jq '.files[].filename')
  while read -r _ f; do
    grep -qxF "$f" <<< "$quebrados" || { echo 0; return; }
  done <<< "$mods"
  echo 1
}

# checks da aceitação: na VIA RÁPIDA são só informativos (não contam e não são exigidos)
ACEITACAO_INFORMATIVA='^(aceitacao|triagem|@pos-migration [(]informativo[)])$'

# Janela temporária (CEO 15/10, contexto e89e0d62): a aceitação VERMELHA da via REVISADA NÃO bloqueia até
# 2026-10-17 11:00 America/Sao_Paulo (= 2026-10-17T14:00:00Z); depois volta a bloquear SOZINHA. Só a aceitação —
# gates/checks estáticos, preview (Vercel), MERGE AUTORIZADO do revisor e conflito continuam valendo.
# FILA_AGORA_EPOCH (epoch UTC) deixa o gate provar os dois lados da data; sem ela, usa o agora real.
JANELA_ACEITACAO_REVISADA_FIM='2026-10-17T14:00:00Z'
aceitacao_dispensada() { [ "${FILA_AGORA_EPOCH:-$(date -u +%s)}" -lt "$(date -u -d "$JANELA_ACEITACAO_REVISADA_FIM" +%s)" ]; }

# QUARENTENA DE JORNADAS (CEO 17/10, presente): spec que falha na aceitação da PR mas JÁ está em
# scripts/merge/quarentena-jornadas.txt (falha também na main, sem relação com a PR) NÃO bloqueia PR alheia — vira P1 ao
# Code dono (uma vez por run, sem repetir enquanto houver tarefa aberta). Continuam bloqueando: spec da PRÓPRIA PR,
# falha NOVA (spec fora da lista) e falha ilegível (fail-closed). FILA_QUARENTENA_JORNADAS sobrescreve o arquivo (gate).
QUARENTENA_JORNADAS=${FILA_QUARENTENA_JORNADAS:-"$(dirname "${BASH_SOURCE[0]}")/quarentena-jornadas.txt"}
quarentena_specs() { [ -f "$QUARENTENA_JORNADAS" ] && grep -v '^[[:space:]]*#' "$QUARENTENA_JORNADAS" | cut -d'|' -f1 | sed '/^$/d' | sort -u; return 0; }
quarentena_dono() { grep -F "$1|" "$QUARENTENA_JORNADAS" 2> /dev/null | head -1 | cut -d'|' -f3; }
# P1 automático ao dono do spec em quarentena que falhou na aceitação da PR $1 (run $3). No-op sem SUPABASE (nunca quebra a fila).
p1_quarentena() {
  local pr=$1 specs=$2 run=$3 spec code assunto corpo ja
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || return 0
  while IFS= read -r spec; do
    [ -n "$spec" ] || continue
    code=$(quarentena_dono "$spec"); [ -n "$code" ] || continue
    assunto="P1 quarentena: jornada $(basename "$spec") falha na main e nas PRs"
    ja=$(curl -fsS "$SUPABASE_URL/rest/v1/erp_agente_mensagem?assunto=eq.$(jq -rn --arg a "$assunto" '$a|@uri')&status=neq.concluida&select=id&limit=1" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" 2> /dev/null | jq -r 'if type=="array" then length else 0 end' 2> /dev/null || echo 0)
    [ "${ja:-0}" = 0 ] || continue
    corpo="O spec $spec está em QUARENTENA na fila de merge (falha também na main; não bloqueia PR alheia). Prioridade P1: corrija o spec (teste desatualizado/instável no celular) ou o código (regressão real, RD-97) e remova a linha de scripts/merge/quarentena-jornadas.txt na mesma PR. Último run visto: https://github.com/$REPO/actions/runs/$run (PR #$pr)."
    curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/fn_agente_mensagem_enviar" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg para "$code" --arg assunto "$assunto" --arg corpo "$corpo" --arg ep "fila-merge · quarentena de jornadas (run $run)" \
            '{p_para:$para, p_de:"eng_chefe", p_tipo:"tarefa", p_assunto:$assunto, p_corpo:$corpo, p_requer_ok_ceo:false, p_enviado_por:$ep}')" \
      > /dev/null 2>&1 && log "quarentena: P1 enviado a $code para $spec" || log "quarentena: NÃO consegui enviar o P1 de $spec a $code — Eng. Chefe, acione à mão"
  done <<< "$specs"
}

# COMPARAÇÃO COM A MAIN (CEO 17/10 14:35 BRT, aprovada; Eng. Chefe msg bad99b31): a aceitação da main #462 falhou (ambiente de
# teste doente) e travava PRs sem culpa. REGRA TEMPORÁRIA: se TODOS os specs que falharam na aceitação da PR já falharam na
# ÚLTIMA aceitação da main (workflow aceitacao-main.yml), a aceitação da PR não bloqueia (comentário na PR com as falhas
# herdadas). Qualquer falha que a main não tem → bloqueia; spec da PRÓPRIA PR → bloqueia sempre (checado antes); falha
# ilegível → fail-closed. VALIDADE: 24 h a partir de BASELINE_MAIN_INICIO e desliga SOZINHA quando a última aceitação da main
# concluída não for falha (voltou a passar). FILA_BASELINE_MAIN_SPECS (mesmo vazio) sobrescreve a lista da main (para o gate).
BASELINE_MAIN_INICIO='2026-10-17T17:35:00Z'
BASELINE_MAIN_FIM='2026-10-18T17:35:00Z'
baseline_main_ativa() {
  local agora=${FILA_AGORA_EPOCH:-$(date -u +%s)}
  [ "$agora" -ge "$(date -u -d "$BASELINE_MAIN_INICIO" +%s)" ] && [ "$agora" -lt "$(date -u -d "$BASELINE_MAIN_FIM" +%s)" ]
}
# specs que falharam na última aceitação da main (vazio = regra desligada: main verde, sem run ou ilegível). Um por linha.
baseline_main_specs() {
  local r id conc
  if [ "${FILA_BASELINE_MAIN_SPECS+x}" = x ]; then printf '%s\n' "$FILA_BASELINE_MAIN_SPECS" | sed '/^$/d' | sort -u; return 0; fi
  baseline_main_ativa || return 0
  # só conta run em que a suíte RODOU (job aceitacao-main success/failure): run só com o "decide" e a suíte pulada
  # fecha como success em segundos (#464) e desligava a regra por engano (CEO 17/10).
  local rid
  for rid in $(api "repos/$REPO/actions/workflows/aceitacao-main.yml/runs?branch=main&status=completed&per_page=10" --jq '.workflow_runs[].id' 2> /dev/null || true); do
    conc=$(api "repos/$REPO/actions/runs/$rid/jobs" --jq '[.jobs[]|select(.name=="aceitacao-main")|.conclusion]|first // empty' 2> /dev/null || true)
    case "$conc" in success|failure) id=$rid; break ;; esac
  done
  [ "$conc" = failure ] && [ -n "$id" ] || return 0   # main voltou a passar (ou sem run): a regra desliga sozinha
  pos_specs_falhos "$id"
}
# Comenta UMA vez por run na PR $1 as falhas herdadas da main. $2 = specs herdados, $3 = run da aceitação da PR.
comentar_herdadas_main() {
  local pr=$1 specs=$2 run=$3
  comentarios "$pr" | grep -qF "<!-- fila:baseline-main-$run -->" && return 0
  comentar "$pr" "Fila de merge: a aceitação desta PR está vermelha, mas **todas** as falhas já ocorrem na última aceitação da \`main\` (ambiente de teste, regra temporária do CEO 17/10, vale até $BASELINE_MAIN_FIM ou até a main voltar a passar): \`$(tr '\n' ' ' <<< "$specs")\`. Não bloqueia a publicação. Falha que a main não tem, ou spec desta PR, continua bloqueando.
<!-- fila:baseline-main-$run -->"
  [ "$COMENTOU" = 1 ] || return 0
  printf '%s\n' "\"<!-- fila:baseline-main-$run -->\"" >> "$TMPF/c-$pr"
}

# Verificação de checks do commit de cabeça. $2 = rapida | revisada. Ecoa: ok | esperar:<motivo> | vermelho:<motivo>
estado_checks() {
  local sha=$1 via=${2:-revisada} so_docs=${3:-0} n=${4:-} acc_quar=0 base_main falhos quar_novos linhas pend verm canc acc esgotou id vercel_ok vercel_ruim acc_conc acc_url acc_run proprios
  linhas=$(api "repos/$REPO/commits/$sha/check-runs?per_page=100" --paginate \
    --jq '.check_runs[] | select(.name != "fila") | [.name, .status, (.conclusion // "-"), .details_url] | @tsv')
  # REGRA DO TESTE PRÓPRIO (CEO 16/10): dentro da janela da aceitação revisada (#2665) a aceitação é informativa — MAS se um
  # spec que FALHOU na aceitação é da PRÓPRIA PR (arquivo e2e/*.spec.ts que ela criou/alterou), NÃO publica. Specs de outras
  # áreas seguem informativos. (A #2506 entrou com o próprio spec vermelho e só foi pega pelo @pos, travando 24 PRs.)
  if [ "$via" = revisada ] && aceitacao_dispensada && [ -n "$n" ]; then
    acc_conc=$(awk -F'\t' '$1 == "aceitacao" {print $3}' <<< "$linhas" | tail -1)
    acc_url=$(awk -F'\t' '$1 == "aceitacao" {print $4}' <<< "$linhas" | tail -1)
    if [ "$acc_conc" = failure ] && [ -n "$acc_url" ]; then
      acc_run=$(sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p' <<< "$acc_url")
      if [ -n "$acc_run" ]; then
        # specs que falharam na aceitação (anotações, técnica da #2677) ∩ specs e2e que a PR tocou
        proprios=$(comm -12 <(pos_specs_falhos "$acc_run") <(pr_specs_proprios "$n"))
        [ -z "$proprios" ] || { echo "vermelho:spec da própria PR falhando: $(tr '\n' ' ' <<< "$proprios")"; return; }
      fi
    fi
  fi
  # QUARENTENA DE JORNADAS (CEO 17/10): aceitação vermelha FORA da janela (a dentro já é informativa). Spec da própria PR
  # bloqueia; se TODO spec falho está na quarentena → a aceitação vira informativa + P1 ao dono; qualquer spec fora da
  # lista (falha NOVA) ou falha ilegível → segue bloqueando como sempre.
  if [ "$via" = revisada ] && ! aceitacao_dispensada && [ -n "$n" ]; then
    acc_conc=$(awk -F'\t' '$1 == "aceitacao" {print $3}' <<< "$linhas" | tail -1)
    acc_url=$(awk -F'\t' '$1 == "aceitacao" {print $4}' <<< "$linhas" | tail -1)
    acc_run=$(sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p' <<< "$acc_url")
    if [ "$acc_conc" = failure ] && [ -n "$acc_run" ]; then
      falhos=$(pos_specs_falhos "$acc_run")
      proprios=$(comm -12 <(printf '%s\n' "$falhos" | sed '/^$/d') <(pr_specs_proprios "$n"))
      [ -z "$proprios" ] || { echo "vermelho:spec da própria PR falhando: $(tr '\n' ' ' <<< "$proprios")"; return; }
      if [ -n "$falhos" ]; then
        quar_novos=$(comm -23 <(printf '%s\n' "$falhos") <(quarentena_specs))
        if [ -n "$quar_novos" ] && baseline_main_ativa; then
          # o que sobrou também falha na última aceitação da main? (comparação com a main, CEO 17/10)
          base_main=$(baseline_main_specs)
          if [ -n "$base_main" ] && [ -z "$(comm -23 <(printf '%s\n' "$quar_novos") <(printf '%s\n' "$base_main"))" ]; then
            acc_quar=1
            log "#$n: aceitação vermelha só com falhas que a main também tem ($(tr '\n' ' ' <<< "$quar_novos")) — não bloqueia (CEO 17/10)" >&2
            comentar_herdadas_main "$n" "$quar_novos" "$acc_run" >&2
          fi
        fi
        if [ -z "$quar_novos" ]; then
          acc_quar=1
          log "#$n: aceitação vermelha só com specs em quarentena ($(tr '\n' ' ' <<< "$falhos")) — não bloqueia (CEO 17/10)" >&2
          p1_quarentena "$n" "$falhos" "$acc_run" >&2
        fi
      fi
    fi
  fi
  # via rápida SEMPRE, e via revisada DENTRO DA JANELA (CEO 15/10): tira a aceitação do cálculo de pendentes/vermelhos/cancelados
  if [ "$via" = rapida ] || aceitacao_dispensada || [ "$acc_quar" = 1 ]; then linhas=$(awk -F'\t' -v re="$ACEITACAO_INFORMATIVA" '$1 !~ re' <<< "$linhas"); fi
  pend=$(awk -F'\t' '$2 != "completed" {print $1}' <<< "$linhas" | sort -u | paste -sd, -)
  verm=$(awk -F'\t' '$3 ~ /^(failure|timed_out|action_required|startup_failure|stale)$/ {print $1}' <<< "$linhas" | sort -u | paste -sd, -)
  canc=$(awk -F'\t' '$3 == "cancelled" {print $4}' <<< "$linhas" | sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p' | sort -u)
  [ -z "$verm" ] || { echo "vermelho:check vermelho: $verm"; return; }
  [ -z "$pend" ] || { echo "esperar:checks rodando: $pend"; return; }
  if [ -n "$canc" ]; then
    esgotou=0
    for id in $canc; do rerodar "$id" >&2 || esgotou=1; done
    # run cancelado que já gastou as 3 tentativas nunca vai completar: sai da fila com motivo (era "re-disparado" eterno, 12/10)
    [ "$esgotou" = 1 ] && { echo "vermelho:check cancelado 3 vezes seguidas (use /re-rodar ou empurre um commit)"; return; }
    echo "esperar:check cancelado re-disparado"; return
  fi
  # gates (scripts/gates/): saíram do build da Vercel para o workflow gates.yml (CEO 07/10) — têm de existir e estar
  # verdes nas DUAS vias
  case "$(awk -F'\t' '$1 == "gates" {print $3}' <<< "$linhas" | tail -1)" in
    success) ;; '') echo "esperar:gates ainda não rodaram"; return;; *) echo "vermelho:gates não estão verdes"; return;;
  esac
  # PR só de .md/docs/.github não tem preview nem aceitação (Ignored Build Step): basta checks + gates
  [ "$so_docs" = 1 ] && { echo ok; return; }
  # aceitação (preview): na via REVISADA tem de existir e estar verde (ou dispensada pela triagem) — salvo DENTRO da janela (CEO 15/10)
  if [ "$via" = revisada ] && ! aceitacao_dispensada && [ "$acc_quar" != 1 ]; then
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
  local n=$1 pid pid_cru corpo pid_aut base
  git fetch -q origin "pull/$n/head:refs/fila/pr-$n" --force
  # CEO 16/10 16:45: patch-id ESTÁVEL à renumeração de migration (scripts/merge/patch-id-lib.sh); o cru entra só para
  # autorizações antigas. PR sem patch-id calculável é dita, nunca pulada em silêncio.
  base=$(git merge-base origin/main "refs/fila/pr-$n" 2> /dev/null || true)
  [ -n "$base" ] || { echo "vermelho:não consegui calcular o patch-id (sem merge-base com a main) — a fila tenta de novo no próximo commit"; return; }
  pid=$(patch_id_estavel "$base" "refs/fila/pr-$n" || true); pid_cru=$(patch_id_cru "$base" "refs/fila/pr-$n" || true)
  [ -n "$pid" ] || { echo "vermelho:não consegui calcular o patch-id do conteúdo (diff vazio ou falha do git) — a fila tenta de novo no próximo commit"; return; }
  # só vale comentário cuja PRIMEIRA linha é exatamente a autorização do revisor; aviso da fila (marca escondida ou
  # "Fila de merge:") cita o texto mas nunca conta (todos os comentários saem da mesma conta do GitHub)
  corpo=$(comentarios "$n" | jq -rs --arg re "^MERGE AUTORIZADO #$n — gilberto-revisor · patch-id [0-9a-f]{8,40}([ \\t\\r]*|[:\\s].*)\$" \
    '[.[] | select((contains("<!-- fila:") | not) and (startswith("Fila de merge:") | not) and (split("\n")[0] | test($re)))] | last // empty | split("\n")[0]')
  # CEO 16/10: "FORA DA LISTA DE REVISÃO — pode mergear … (patch-id <hex>)" também libera, com as MESMAS travas (primeira
  # linha, sem marca da fila, patch-id que casa com o conteúdo atual) e só se for o comentário MAIS RECENTE do revisor
  # (um AJUSTES ANTES DO MERGE / AGUARDANDO ENG. CHEFE depois dele cancela; AJUSTES nunca libera).
  fora=$(comentarios "$n" | jq -rs --arg n "$n" \
    '[.[] | select((contains("<!-- fila:") | not) and (startswith("Fila de merge:") | not)
        and (split("\n")[0] | test("^(MERGE AUTORIZADO #" + $n + " — gilberto-revisor|FORA DA LISTA DE REVISÃO|AJUSTES ANTES DO MERGE|AGUARDANDO ENG\\. CHEFE)")))]
      | last // empty | split("\n")[0] | select(test("^FORA DA LISTA DE REVISÃO — pode mergear.*\\(patch-id [0-9a-f]{8,40}\\)[ \\t\\r]*$"))')
  [ -n "$fora" ] && corpo=$fora
  [ -n "$corpo" ] || { echo "vermelho:PR sensível ($SENSIVEL) sem a autorização do revisor para o conteúdo atual"; return; }
  pid_aut=$(grep -oE 'patch-id[: ]+[0-9a-f]{8,40}' <<< "$corpo" | tail -1 | grep -oE '[0-9a-f]{8,40}$' || true)
  [ -n "$pid_aut" ] || { echo "vermelho:a autorização do revisor não traz o identificador do conteúdo — o revisor repete após rodar \`scripts/merge/patch-id.sh $n\`"; return; }
  autorizacao_casa "$pid_aut" "$pid" "$pid_cru" || { echo "vermelho:o conteúdo mudou depois da autorização do revisor — exige nova revisão"; return; }
  echo ok
}

git fetch -q origin main
MAIN0=$(git rev-parse origin/main)   # main do INÍCIO da rodada: o `atras` é medido contra ela, não contra a main viva
                                     # (que muda a cada merge do lote). Assim a PR em dia no começo não vira "atrás" sozinha.
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
# Prioridade (CEO 15/10): Hub (#2569 #2508 #2298) e FC/FCR (#2100) na frente; o resto segue a ordem de entrada.
FILA_PRIORIDADE=${FILA_PRIORIDADE:-'2569 2508 2298 2100'}
_prio=''; for p in $FILA_PRIORIDADE; do grep -qw "$p" <<< "$fila" && _prio="$_prio $p"; done
_resto=''; for q in $fila; do grep -qw "$q" <<< "$FILA_PRIORIDADE" || _resto="$_resto $q"; done
fila=$(echo $_prio $_resto)
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
# as próximas N da ordem; as demais esperam a vez (sem build) até uma da frente mergear.
ATUALIZA_NA_VEZ=${ATUALIZA_NA_VEZ:-4}
em_preparo=0
# LOTE (CEO 09/10): PR SEM migration publica em lote na mesma rodada (corta runs/builds de publicação). PR COM migration
# é UMA por rodada e encerra a rodada. merges = quantas já saíram no lote; LOTE_MAX = teto por rodada (teto de risco).
LOTE_MAX=${LOTE_MAX:-6}
# RITMO (CEO 15/10): teto de publicações por hora. Conta as PRs já mergeadas na main na última hora (fail-open: erro de
# API/valor não-numérico = 0, a rodada segue), para a janela aberta da via revisada não virar enxurrada de merges.
RITMO_MAX_HORA=${RITMO_MAX_HORA:-4}
pub_hora=${FILA_PUB_HORA:-$(api "search/issues?q=repo:$REPO+is:pr+is:merged+base:main+merged:>=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" --jq '.total_count' 2>/dev/null || echo 0)}
[ "${pub_hora:-0}" -eq "${pub_hora:-0}" ] 2>/dev/null || pub_hora=0
disp_hora=$((RITMO_MAX_HORA - pub_hora))
if [ "$disp_hora" -le 0 ]; then log "ritmo: $pub_hora publicação(ões) na última hora (teto $RITMO_MAX_HORA/h): rodada adiada"; exit 0; fi
[ "$LOTE_MAX" -gt "$disp_hora" ] && LOTE_MAX=$disp_hora
merges=0
# LOTE DE MIGRATIONS INDEPENDENTES (CEO 16/10): numa rodada publica até LOTE_MIG_MAX PRs COM migration, desde que
# INDEPENDENTES entre si (scripts/merge/migrations-independentes.ts; qualquer dúvida → 1 por rodada, como antes).
# O @pos-migration da main roda uma vez para o lote. LOTE_MIG_MAX=1 desliga (comportamento antigo).
LOTE_MIG_MAX=${LOTE_MIG_MAX:-3}
lote_mig_n=0; lote_mig_sqls=()
mkdir -p "$TMPF/mig"
# SQL das migrations da PR no SHA conferido → $TMPF/mig/<n>.sql (vazio/falha = dúvida na checagem de independência)
baixar_sql_migrations() {
  local n=$1 sha=$2 f c; : > "$TMPF/mig/$n.sql"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    c=$(api "repos/$REPO/contents/$f?ref=$sha" --jq .content 2> /dev/null | tr -d '\n' | base64 -d 2> /dev/null) || { : > "$TMPF/mig/$n.sql"; return 1; }
    [ -n "$c" ] || { : > "$TMPF/mig/$n.sql"; return 1; }
    printf '%s\n' "$c" >> "$TMPF/mig/$n.sql"
  done <<< "$(grep '^supabase/migrations/' <<< "$arquivos")"
}
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
  # PR COM migration não vai nesta rodada se outra migration já espera a main (so_sem_migration) OU já houve merge no lote
  # (merges>0: a main acabou de mudar — a migration vai na próxima rodada, contra a main já assentada/verde).
  # conserto do deploy vermelho da main (corrige_deploy_vermelho): não espera a main nem as outras migrations
  corrige_deploy=0
  [ "$com_migration" = 1 ] && corrige_deploy=$(corrige_deploy_vermelho "$n")
  [ "$corrige_deploy" = 1 ] && log "#$n só corrige migration que quebrou o deploy-migrations da main: não espera a main"
  # lote de migrations já aberto nesta rodada: só entram outras migrations, e só se INDEPENDENTES das do lote
  if [ "$lote_mig_n" -gt 0 ] && [ "$com_migration" = 0 ]; then log "#$n (sem migration): espera a próxima rodada — há lote de migrations nesta"; continue; fi
  if [ "$com_migration" = 1 ] && [ "$corrige_deploy" = 0 ]; then
    if [ "$so_sem_migration" = 1 ] || { [ "$merges" -gt 0 ] && [ "$lote_mig_n" = 0 ]; }; then log "#$n tem migration: espera a main (atrás da anterior)"; continue; fi
    if [ "$lote_mig_n" -gt 0 ]; then
      baixar_sql_migrations "$n" "$sha" || true
      ind=$(npx --yes tsx "$(dirname "${BASH_SOURCE[0]}")/migrations-independentes.ts" "$TMPF/mig/$n.sql" "${lote_mig_sqls[@]}" 2> /dev/null || echo "duvida:checagem falhou")
      if [ "$ind" != ok ]; then log "#$n tem migration não comprovadamente independente do lote (${ind#duvida:}): espera a próxima rodada"; continue; fi
      log "#$n: migration independente das $lote_mig_n já no lote"
    fi
  fi

  # (e) via: COM revisao-eng-chefe = revisada (aceitação + autorização); SEM = rápida (aceitação informativa)
  via=rapida
  jq -e --arg l "$SENSIVEL" '.labels | map(.name) | index($l)' <<< "$pj" > /dev/null && via=revisada
  # Eng. Chefe 14/10: tela/cálculo/migration/área crítica NUNCA publica pela via rápida, mesmo sem etiqueta (furo da #2592):
  # a fila coloca a etiqueta e espera o MERGE AUTORIZADO do revisor (o patch-id é conferido na próxima rodada).
  if [ "$via" = rapida ] && [ "$(printf '%s\n' "$arquivos" | npx --yes tsx scripts/merge/exige-via-revisada.ts 2>/dev/null | jq -r '.revisada // false' 2>/dev/null)" = true ]; then
    log "#$n toca tela/cálculo/migration/área crítica sem etiqueta: ponho $SENSIVEL e espero a autorização"
    api -X POST "repos/$REPO/issues/$n/labels" -f "labels[]=$SENSIVEL" > /dev/null 2>&1 || true
    continue
  fi
  log "#$n segue a $([ "$via" = rapida ] && echo 'via rápida (checks + preview; aceitação informativa)' || echo 'via revisada (aceitação verde + MERGE AUTORIZADO)')"

  # (c) sensível → autorização pelo conteúdo
  if [ "$via" = revisada ]; then
    a=$(autorizacao "$n")
    [ "$a" = ok ] || { tirar_da_fila "$n" "${a#vermelho:}" "$sha"; continue; }
    log "#$n: autorização do gilberto-revisor confere com o conteúdo (patch-id)"
  fi

  # checks ANTES de atualizar com a main (CEO 08/10, fila sem etiqueta): só a PR verde é atualizada — a vermelha
  # recebe o aviso e fica como está (sem empurrar merge da main no ramo de quem ainda não acabou a PR).
  c=$(estado_checks "$sha" "$via" "$so_docs" "$n")
  case "$c" in
    vermelho:*)
      # Deadlock 12/10: vermelho SÓ de guarda que lê o estado da main (check_fn_guards etc.) numa PR atrás da main costuma ser
      # a main já corrigida depois do commit da PR; como a fila não atualiza PR vermelha, ela nunca re-rodava. Atualiza uma vez
      # (o novo commit re-roda os guardas); se continuar vermelho com a PR em dia, cai na recusa normal.
      if [[ "${c#vermelho:check vermelho: }" =~ ^(check_fn_guards|check_menu|check_migrations)(,(check_fn_guards|check_menu|check_migrations))*$ ]] \
         && [ "$(api "repos/$REPO/compare/$MAIN0...$sha" --jq '.behind_by')" -gt 0 ] && [ "$em_preparo" -lt "$ATUALIZA_NA_VEZ" ]; then
        if api -X PUT "repos/$REPO/pulls/$n/update-branch" -f expected_head_sha="$sha" > /dev/null 2>&1; then
          em_preparo=$((em_preparo + 1))
          log "#$n vermelha só de guarda (${c#vermelho:}) e atrás da main: atualizada para re-rodar os guardas — segue para a próxima"; continue
        fi
      fi
      tirar_da_fila "$n" "${c#vermelho:} (commit ${sha:0:7})" "$sha"; continue;;
    # Stall 13/10: PR estagnada (aberta antes do gates.yml) nunca teve o check "gates"; como a fila só atualiza PR verde, ela
    # esperava para sempre. Atrás da main e com vaga → update-branch (o novo commit roda os gates), como no deadlock acima.
    esperar:'gates ainda não rodaram')
      if [ "$(api "repos/$REPO/compare/$MAIN0...$sha" --jq '.behind_by')" -gt 0 ] && [ "$em_preparo" -lt "$ATUALIZA_NA_VEZ" ]; then
        # Stall 13/10 14:00: só gasta vaga se o update-branch FUNCIONOU (PR velha com conflito falhava e queimava as 4 vagas).
        if api -X PUT "repos/$REPO/pulls/$n/update-branch" -f expected_head_sha="$sha" > /dev/null 2>&1; then
          em_preparo=$((em_preparo + 1))
          log "#$n sem o check gates e atrás da main: atualizada para rodar os gates — segue para a próxima"; continue
        fi
      fi
      log "#$n aguardando: gates ainda não rodaram — segue para a próxima"; continue;;
    # Só conta como "em preparo" o PREVIEW que a própria fila dispara: PR VIA RÁPIDA com check rodando (não "gates ainda
    # não rodaram", que é PR estagnada). A aceitação (demo-e2e, serial/lenta) das PRs via REVISADA NÃO é preparo da fila —
    # contá-la inflava o em_preparo (13-14 no run 9299) e esfomeava as via-rápida atrás da main. (Correção da regressão do #2361.)
    esperar:*) { [ "$via" = rapida ] && [ "${c#esperar:}" != 'gates ainda não rodaram' ]; } && em_preparo=$((em_preparo + 1)); log "#$n aguardando: ${c#esperar:} — segue para a próxima"; continue;;
  esac

  # atrás da main → atualiza (merge da main no ramo, sem reescrever histórico), MAS só as próximas ATUALIZA_NA_VEZ da
  # ordem; as demais esperam a vez (sem disparar preview/aceitação agora). Cada publicação gera ~N builds, não um por PR.
  atras=$(api "repos/$REPO/compare/$MAIN0...$sha" --jq '.behind_by')
  if [ "$atras" -gt 0 ]; then
    if [ "$em_preparo" -ge "$ATUALIZA_NA_VEZ" ]; then
      log "#$n está $atras atrás da main, mas já há $em_preparo PR(s) da vez em preparo (teto $ATUALIZA_NA_VEZ): espera a vez — sem build agora"; continue
    fi
    # Só gasta vaga se o update-branch FUNCIONOU: PR com conflito não prepara build e não pode ocupar o teto (16/10: 4 PRs
    # em conflito queimavam as 4 vagas e travavam 7 PRs prontas por horas).
    if api -X PUT "repos/$REPO/pulls/$n/update-branch" -f expected_head_sha="$sha" > /dev/null 2>&1; then
      em_preparo=$((em_preparo + 1))
      log "#$n estava $atras commit(s) atrás da main: atualizada (vaga $em_preparo/$ATUALIZA_NA_VEZ); aguardando os checks do novo commit — segue para a próxima"
    else
      tirar_da_fila "$n" "não consegui atualizar com a main (conflito?)" "$sha"; continue
    fi
    continue
  fi

  # (b) só PR COM migration depende da main (deploy + @pos-migration)
  if [ "$com_migration" = 1 ] && [ "$corrige_deploy" = 0 ] && [ "$lote_mig_n" = 0 ]; then
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

  # merge travado no SHA conferido (se alguém empurrou no meio, o GitHub recusa). O GitHub faz o 3-way contra a main VIVA:
  # PR sem migration que só está "atrás" das outras deste lote (não conflitante) é mergeada; conflito real → recusa abaixo.
  if out=$(api -X PUT "repos/$REPO/pulls/$n/merge" -f merge_method=squash -f sha="$sha" -f commit_title="$titulo (#$n)" 2>&1); then
    if [ "$com_migration" = 1 ]; then
      # migration: publica e abre/segue o LOTE de migrations independentes (até LOTE_MIG_MAX); fechado o lote, ENCERRA a rodada
      # (a próxima migration espera o deploy + @pos-migration do lote)
      lote_mig_n=$((lote_mig_n + 1)); merges=$((merges + 1))
      [ -s "$TMPF/mig/$n.sql" ] || baixar_sql_migrations "$n" "$sha" || true
      lote_mig_sqls+=("$TMPF/mig/$n.sql")
      log "#$n MERGEADA (squash, ${sha:0:7}) pela via $([ "$via" = rapida ] && echo rápida || echo revisada) — tem migration: lote de migrations $lote_mig_n/$LOTE_MIG_MAX"
      comentar "$n" "✅ **Fila de merge:** mergeada (squash) no commit conferido \`${sha:0:7}\` pela **via $([ "$via" = rapida ] && echo 'rápida**' || echo 'revisada**'). Tem migration (lote $lote_mig_n/$LOTE_MIG_MAX de migrations independentes): veredito no @pos-migration da main (vermelho = reverter a PR que quebrou)."
      if [ "$lote_mig_n" -ge "$LOTE_MIG_MAX" ] || [ "$merges" -ge "$LOTE_MAX" ]; then exit 0; fi
      continue
    fi
    # LOTE (CEO 09/10): PR SEM migration publica em lote na mesma rodada. A aceitação da via rápida é informativa e a
    # aceitação da main (de hora em hora, banco de testes) é a rede de segurança; teto LOTE_MAX por rodada.
    merges=$((merges + 1))
    log "#$n MERGEADA (squash, ${sha:0:7}) pela via $([ "$via" = rapida ] && echo rápida || echo revisada) — lote $merges/$LOTE_MAX"
    comentar "$n" "✅ **Fila de merge:** mergeada (squash, lote) no commit conferido \`${sha:0:7}\` pela **via $([ "$via" = rapida ] && echo 'rápida** (aceitação informativa; a aceitação da main roda de hora em hora)' || echo 'revisada**')."
    if [ "$merges" -ge "$LOTE_MAX" ]; then log "teto do lote ($LOTE_MAX) atingido nesta rodada: as próximas seguem na próxima rodada"; exit 0; fi
    continue
  fi
  tirar_da_fila "$n" "o GitHub recusou o merge: $(tr '\n' ' ' <<< "$out" | cut -c1-300)" "$sha"
done
log "nenhuma PR pronta para merge nesta rodada"
