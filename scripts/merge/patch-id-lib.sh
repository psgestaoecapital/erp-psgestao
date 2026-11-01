#!/usr/bin/env bash
# Funções do patch-id do CONTEÚDO de uma PR (CEO 16/10 16:45) — usadas pelo patch-id.sh (o que o revisor cola) e pela
# fila (o que ela confere), para os dois calcularem EXATAMENTE a mesma coisa.
#
# patch-id ESTÁVEL à renumeração: a fila renumera o arquivo de migration (supabase/migrations/<14 dígitos>_nome.sql)
# quando a versão não é maior que a da main. Só o NOME muda; o conteúdo é o mesmo. Por isso o prefixo de versão do
# nome entra no cálculo como um marcador fixo — renumerar não muda o patch-id e a autorização do revisor continua valendo.
# Mudou o conteúdo do SQL (ou qualquer outro arquivo) → o patch-id muda e exige nova revisão.

# patch_id_estavel <base> <alvo>  → 40 hex (vazio se o diff não puder ser calculado)
patch_id_estavel() {
  git diff "$1" "$2" \
    | sed -E 's#(supabase/migrations/)[0-9]{14}_#\1VERSAO_#g' \
    | git patch-id --stable | cut -d' ' -f1
}

# patch_id_cru <base> <alvo>  → patch-id sem normalizar (autorizações antigas, anteriores à normalização)
patch_id_cru() {
  git diff "$1" "$2" | git patch-id --stable | cut -d' ' -f1
}

# autorizacao_casa <id_autorizado> <id_estavel> <id_cru>  → 0 se a autorização vale para o conteúdo
# Aceita o id inteiro (40 hex) ou um PREFIXO de pelo menos 8 hex (comentário abreviado do revisor, caso #2559). Prefixo
# curto demais (<8) é ambíguo e NÃO casa.
autorizacao_casa() {
  local aut=$1 est=$2 cru=$3
  [ "${#aut}" -ge 8 ] && [ "${#aut}" -le 40 ] || return 1
  [ -n "$est" ] && [ "${est:0:${#aut}}" = "$aut" ] && return 0
  [ -n "$cru" ] && [ "${cru:0:${#aut}}" = "$aut" ] && return 0
  return 1
}
