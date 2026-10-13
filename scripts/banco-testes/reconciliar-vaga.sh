#!/usr/bin/env bash
# CEO 13/10 19:58 — CONTAMINAÇÃO ENTRE PRs no banco de teste da vaga. O sync (#2519) traz o que falta da main, mas não
# REMOVE o que sobrou de uma PR (migration não aprovada aplicada na vaga por execução cancelada/fora do fluxo). Ex.: vaga 1
# ficou com 20261013200030 (fn_ge_listagem_v2 alterada pela PR #2515, aberta) → a próxima PR na vaga testaria com código
# não aprovado.
#
# ESTE SCRIPT É A GUARDA SOBERANA (pontos 2 e 3 do pedido): detecta contaminação e NUNCA deixa um banco sujo ser testado.
# Contaminação = versão no ledger ESTRITAMENTE MAIOR que a maior versão da main (origin/main). NÃO usamos "não está na
# main" porque o ledger tem ~800 linhas históricas que não casam 1:1 com arquivos e jamais devem ser tocadas. Uma migration
# aplicada numa vaga SEMPRE carimba o ledger (supabase db push), então "ledger > main" é prova sólida de que rodou migration
# de PR ali.
#
# Ao detectar, FALHA com exit 2 e "vaga N precisa de recriar". A própria contaminação persiste e barra os próximos runs
# até o Montar (recriar) limpar — é a marca de "suja", sem tabela de controle. A restauração CIRÚRGICA (recriar só os
# objetos tocados a partir da produção, sem o recriar de 18 min) fica para um PR seguinte, validável no dado da vaga 1
# contaminada: derrubar/redefinir objeto no banco de teste é destrutivo e só entra depois de provado contra a vaga real.
#
# Uso: TEST_DATABASE_URL=<vaga pooler>  MAIN_MIGR_DIR=<dir origin/main>  [VAGA=N] [PSQL=psql]  reconciliar-vaga.sh
#   exit 0 = vaga limpa (ledger <= main) · exit 2 = vaga contaminada (precisa de recriar) · exit 1 = erro de uso/guarda
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}" "${MAIN_MIGR_DIR:?MAIN_MIGR_DIR ausente}"
PSQL="${PSQL:-psql}"
VAGA="${VAGA:-?}"
PROD_REF=horsymhsinqcimflrtjo
erro() { echo "::error::$*"; exit 1; }

# Travas: nunca a produção; destino é Session pooler de teste.
case "$TEST_DATABASE_URL" in *"$PROD_REF"*) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado";; esac
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) erro "vaga ${VAGA}: TEST_DATABASE_URL precisa ser Session pooler";; esac

main_max=$(ls "$MAIN_MIGR_DIR"/*.sql 2>/dev/null | sed -E 's#.*/([0-9]+)_.*#\1#' | LC_ALL=C sort | tail -1)
[ -n "$main_max" ] || erro "não achei migrations em MAIN_MIGR_DIR ($MAIN_MIGR_DIR)"

mapfile -t extras < <("$PSQL" "$TEST_DATABASE_URL" -tAc "select version from supabase_migrations.schema_migrations where version > '$main_max' order by version")
if [ "${#extras[@]}" -eq 0 ]; then
  echo "vaga ${VAGA}: ledger em dia com a main (nenhuma versão > $main_max) — banco limpo."
  exit 0
fi

echo "::error::vaga ${VAGA} CONTAMINADA: o ledger tem ${#extras[@]} versão(ões) de PR não aprovada além da main ($main_max): ${extras[*]}"
echo "::error::vaga ${VAGA} precisa de recriar — testar aqui usaria schema não aprovado (contaminação entre PRs). Rode o Montar (recriar) nesta vaga."
exit 2
