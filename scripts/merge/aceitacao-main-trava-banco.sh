#!/usr/bin/env bash
# Guarda do banco da aceitação da MAIN (CEO 18/10, sessão interativa) — a aceitação da main passa a rodar na VAGA 1
# (banco de REFERÊNCIA, erp-psgestao-testes-2 = mgyxiamybepkphtfhway), no grupo da vaga 1 (aceitacao-testes-1), sem
# disputar vaga com as PRs. Três travas, TODAS obrigatórias; qualquer uma falha → aborta (nunca testa no banco errado,
# nunca na produção):
#   1) allowlist POSITIVO: a URL da API e a do Postgres precisam conter o id do projeto da vaga 1 (ESPERADO).
#   2) anti-produção: o id da produção (horsymhsinqcimflrtjo) em QUALQUER URL → aborta.
#   3) a URL do Postgres precisa ser o Session pooler (*.pooler.supabase.com) — a mesma exigência do aceitacao-pr.yml.
# Mapa de referência (não é segredo): vaga 0=xjzqndnvjkdjyisuklpy, vaga 1=mgyxiamybepkphtfhway,
# vaga 2=jvntcgqoeuckljzeojxp, produção=horsymhsinqcimflrtjo.
#
# Uso: ESPERADO=<id> URL=<api url da vaga 1> DBURL=<postgres url da vaga 1> scripts/merge/aceitacao-main-trava-banco.sh
set -uo pipefail
ESPERADO="${ESPERADO:-mgyxiamybepkphtfhway}"   # projeto da vaga 1 (banco de referência)
PROD='horsymhsinqcimflrtjo'                    # produção — NUNCA
URL="${URL:-}"; DBURL="${DBURL:-}"
erro() { echo "::error::aceitação da main (vaga 1): $1"; exit 1; }

[ -n "$URL" ]   || erro "TEST_SUPABASE_URL_1 ausente"
[ -n "$DBURL" ] || erro "TEST_DATABASE_URL_1 ausente"
# (2) anti-produção primeiro — a trava que nunca pode faltar
case "$URL$DBURL" in *"$PROD"*) erro "URL aponta para a PRODUÇÃO ($PROD) — abortado";; esac
# (1) allowlist positivo do projeto da vaga 1 (nas DUAS URLs)
case "$URL"   in *"$ESPERADO"*) : ;; *) erro "TEST_SUPABASE_URL_1 não é o projeto da vaga 1 ($ESPERADO) — abortado";; esac
case "$DBURL" in *"$ESPERADO"*) : ;; *) erro "TEST_DATABASE_URL_1 não é o projeto da vaga 1 ($ESPERADO) — abortado";; esac
# (3) Session pooler
case "$DBURL" in *pooler.supabase.com*) : ;; *) erro "TEST_DATABASE_URL_1 precisa ser Session pooler (*.pooler.supabase.com)";; esac
echo "banco da vaga 1 (referência) confirmado: projeto $ESPERADO"
