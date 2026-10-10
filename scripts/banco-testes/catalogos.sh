#!/usr/bin/env bash
# Autorizado pelo CEO em 06/10/2026 17:38 (erp_contexto_projeto f08edfe1): copia da PRODUÇÃO para o BANCO DE TESTES
# só os DADOS das tabelas globais de referência da whitelist scripts/banco-testes/catalogos.txt (sem coluna de dono,
# sem dado pessoal). Resolve: fn_demo_reset falhava no banco de testes porque plan_catalog estava vazio (v15_revenda).
#
# Uso (o workflow montar-banco-testes monta as URLs):
#   PROD_DATABASE_URL=... TEST_DATABASE_URL=... [PG_DUMP=pg_dump] [PSQL=psql] scripts/banco-testes/catalogos.sh
#
# Produção: só leitura — consulta ao catálogo do Postgres (trava de colunas) + pg_dump --data-only -t de cada tabela
# (pg_dump abre transação READ ONLY; --lock-wait-timeout não deixa esperar trava). Nada é gravado na produção.
# Testes: numa transação só, com session_replication_role=replica (triggers e FKs não disparam — ex.: o alerta de
# tela órfã de system_screens e o vínculo automático de module_catalog), apaga e recarrega cada tabela da lista.
set -euo pipefail
: "${PROD_DATABASE_URL:?PROD_DATABASE_URL ausente}" "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PSQL="${PSQL:-psql}"
LISTA="${LISTA:-scripts/banco-testes/catalogos.txt}"
PROD_REF=horsymhsinqcimflrtjo
TEST_REF=xjzqndnvjkdjyisuklpy
erro() { echo "::error::$*"; exit 1; }

# Trava de destino/origem: o destino NUNCA é a produção; a origem só pode ser a produção.
case "$TEST_DATABASE_URL" in *"$PROD_REF"*) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado";; esac
case "$TEST_DATABASE_URL" in *"$TEST_REF"*) ;; *) erro "TEST_DATABASE_URL não é o projeto erp-psgestao-testes";; esac
case "$PROD_DATABASE_URL" in *"$PROD_REF"*) ;; *) erro "PROD_DATABASE_URL não é o projeto de produção";; esac
case "$PROD_DATABASE_URL" in *"$TEST_REF"*) erro "PROD_DATABASE_URL aponta para o banco de testes";; esac

mapfile -t TABELAS < <(sed -E 's/#.*//; s/[[:space:]]+//g' "$LISTA" | grep -v '^$')
[ "${#TABELAS[@]}" -gt 0 ] || erro "whitelist $LISTA vazia"
for t in "${TABELAS[@]}"; do
  [[ "$t" =~ ^[a-z_][a-z0-9_]*$ ]] || erro "nome inválido na whitelist: '$t'"
  # nomes proibidos mesmo que alguém os ponha na lista
  [[ "$t" =~ (^auth|^storage|^vault|^cron|^_|(^|_)logs?(_|$)|mensagem|contexto|handoff|bkp|backup|history|historico|sessao|usuario|users?(_|$)) ]] \
    && erro "tabela proibida na whitelist: $t"
done
echo "whitelist: ${#TABELAS[@]} tabela(s): ${TABELAS[*]}"

# Trava de conteúdo (na produção, só o catálogo do Postgres): toda tabela existe em public e nenhuma tem coluna de
# dono, de autoria (*_por, created_by…) ou de dado pessoal. Qualquer achado aborta ANTES de copiar.
lista_csv=$(IFS=,; echo "${TABELAS[*]}")
achados=$("$PSQL" "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -q -At -v lista="$lista_csv" <<'SQL'
SET statement_timeout = '15s';
WITH t(n) AS (SELECT unnest(string_to_array(:'lista', ',')))
SELECT t.n || ': ' || CASE WHEN c.oid IS NULL THEN 'não existe em public na produção'
  ELSE 'coluna proibida (' || string_agg(a.attname, ',') || ')' END
FROM t
LEFT JOIN pg_class c ON c.relname = t.n AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  AND (a.attname ~ '^(company_id|org_id|user_id|organization_id|tenant_id|empresa_id|cliente_id|profile_id|owner_id|auth_user_id)$'
    OR a.attname ~ '(_por$|_by$|email|cpf|cnpj|telefone|phone|celular|senha|password|token)')
GROUP BY t.n, c.oid
HAVING c.oid IS NULL OR count(a.attname) > 0;
SQL
)
[ -z "$achados" ] || erro "whitelist recusada: $(echo "$achados" | tr '\n' ';')"
echo "trava de colunas: ok (nenhuma coluna de dono/autoria/dado pessoal)"

# Dump: um pg_dump --data-only -t por tabela, na ordem da whitelist (pai antes do filho).
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
i=0
for t in "${TABELAS[@]}"; do
  i=$((i + 1)); f=$(printf '%s/%02d_%s.sql' "$dir" "$i" "$t")
  "$PG_DUMP" "$PROD_DATABASE_URL" --data-only --no-owner --no-privileges --lock-wait-timeout=5000 -t "public.$t" -f "$f"
  # linhas = conteúdo do bloco COPY (até a linha "\.")
  n=$(awk '/^COPY public\./{d=1; next} /^\\\.$/{d=0} d' "$f" | wc -l)
  echo "$t $n" >> "$dir/esperado.txt"
  echo "dump $t: $n linha(s)"
done

# Carga no banco de TESTES: transação única (ou entra tudo ou nada).
{
  echo '\set ON_ERROR_STOP on'
  echo 'BEGIN;'
  echo "SET LOCAL statement_timeout = '10min';"
  echo 'SET LOCAL session_replication_role = replica;'
  for t in "${TABELAS[@]}"; do echo "DELETE FROM public.$t;"; done
  for f in "$dir"/[0-9][0-9]_*.sql; do echo "\\i $f"; done
  echo 'COMMIT;'
} > "$dir/carga.sql"
"$PSQL" "$TEST_DATABASE_URL" -q -f "$dir/carga.sql"

# Conferência (RD-38): contagem no banco de testes = linhas do dump, tabela a tabela.
echo "### Catálogos globais copiados da produção (whitelist, só dados)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "| tabela | produção (dump) | banco de testes |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "|---|---:|---:|" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
diverge=0
while read -r t n; do
  m=$("$PSQL" "$TEST_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "select count(*) from public.$t")
  echo "$t: dump $n · testes $m"
  echo "| $t | $n | $m |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  [ "$n" = "$m" ] || { echo "::error::$t: banco de testes tem $m linha(s), o dump tinha $n"; diverge=1; }
done < "$dir/esperado.txt"
[ "$diverge" = 0 ] || exit 1
echo "catálogos copiados: ok"
