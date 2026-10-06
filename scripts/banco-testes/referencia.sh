#!/usr/bin/env bash
# Copia da PRODUÇÃO (só leitura) para o banco de testes os DADOS das tabelas de referência GLOBAIS (catálogos).
# O dump do banco de testes é só estrutura; sem estes catálogos fn_demo_reset falha (FK plan_catalog etc.).
# WHITELIST explícita: tabelas sem company_id/org_id/user_id e sem PII. Nunca copiar users, auth, vault ou tabela com empresa.
# Idempotente: tabela que já tem linhas no destino é pulada. Ordem = pais antes dos filhos (FK).
# Requer: TEST_DATABASE_URL, PROD_DATABASE_URL (conexão de leitura da produção).
set -uo pipefail
: "${TEST_DATABASE_URL:?}" "${PROD_DATABASE_URL:?}"
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "TEST_DATABASE_URL aponta para a produção — abortado"; exit 1;; esac

WHITELIST=(
  module_subgrupos plan_catalog module_catalog feature_catalog system_screens screen_route_features
  plan_modules rbac_papel rbac_papel_acesso
  erp_gov_nfse_municipios erp_ibpt_item fiscal_codigo_catalogo fiscal_ncm_regras fiscal_lc116_exige_obra
  veic_ncm_faixa erp_fiscal_erro_catalogo erp_rd_catalogo rbac_subgrupo_catalogo
)
falhas=0
for t in "${WHITELIST[@]}"; do
  existe=$(psql "$TEST_DATABASE_URL" -tAc "select to_regclass('public.$t') is not null")
  [ "$existe" = t ] || { echo "· $t: não existe no destino (pulada)"; continue; }
  n=$(psql "$TEST_DATABASE_URL" -tAc "select count(*) from public.$t")
  [ "$n" = 0 ] || { echo "· $t: já tem $n linhas (pulada)"; continue; }
  if { echo "set session_replication_role=replica;"; echo "copy public.$t from stdin;"; \
       psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c "set default_transaction_read_only=on" -c "copy public.$t to stdout"; echo '\.'; } \
     | psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q; then
    echo "✔ $t: $(psql "$TEST_DATABASE_URL" -tAc "select count(*) from public.$t") linhas"
  else
    echo "::warning::referência $t falhou"; falhas=$((falhas+1))
  fi
done
echo "### Referência global copiada: ${#WHITELIST[@]} tabelas na whitelist · falhas: $falhas" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 0
