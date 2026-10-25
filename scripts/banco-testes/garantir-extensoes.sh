#!/usr/bin/env bash
# 25/10 (gilberto-desenv, msg 3e5e6c6a): a aceitação da main #818 (run 40134440043) foi a 1ª a passar da sincronização
# da vaga desde #802 e deu 106 falhas — iguais no [computador] e no [celular], então NÃO é responsividade. Causa comum
# provada nos 3 bancos de teste (testes-pro, testes-2, testes-3): o `pg_trgm` NÃO existe. Na produção ele vive em
# `public` (como o unaccent); as migrations que o criam (ex.: 20260607140000_produtos_trgm_indexes) entraram no banco
# de testes só pelo ledger (marcadas, não rodadas) e o dump --schema public não traz extensões. Resultado:
# "function similarity(text, text) does not exist" em fn_conciliacao_sugerir_match/_lote, fn_conciliacao_inbox,
# fn_pm_jobs_buscar → caem conciliação, inbox, cartão, P&M copiar job, KGF, pagar.
# Aqui: garante no banco de TESTES as extensões no MESMO schema da produção (public). Idempotente; não apaga nem
# altera dado. Chamado por garantir-org-demo.sh, que já roda ANTES de todo `db push` das vagas.
# Uso: TEST_DATABASE_URL=<pooler de teste> scripts/banco-testes/garantir-extensoes.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado"; exit 1;; esac
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) echo "::error::TEST_DATABASE_URL precisa ser Session pooler"; exit 1;; esac
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
SET statement_timeout = '15s';
SET lock_timeout = '5s';
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
SQL
s=$(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select round(public.similarity('conciliacao','conciliação')::numeric, 2) > 0")
[ "$s" = t ] || { echo "::error::pg_trgm ausente na vaga (public.similarity não responde) — as funções de conciliação/busca cairiam"; exit 1; }
echo "extensões da vaga: unaccent e pg_trgm em public (similarity ok)"
