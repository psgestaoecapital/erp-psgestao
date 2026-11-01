#!/usr/bin/env bash
# CEO 11/10 (passada completa de semente — Eng. Chefe): o banco de TESTES nasce de `drop schema public cascade; create schema
# public` com default privileges "grant all" para anon/authenticated/service_role, e o dump de estrutura não traz os
# direitos da produção. Resultado medido em 12/10 (catálogo, nas duas pontas): 1.839 de 1.884 funções com direito de
# EXECUTE diferente da produção (o anon executa quase tudo no teste) — por isso ~40 specs de segurança/LGPD @pos-migration
# ("anon não executa…", "anon não lê nenhuma view", salário legível…) ficavam vermelhos na aceitacao-main SEM ser regressão.
# Este script copia da PRODUÇÃO (só leitura, só catálogo — nenhum dado de tabela) os GRANTs/REVOKEs do schema public
# (schema, tabelas/views/sequências, direito por coluna, funções) e aplica no TESTE. Idempotente; roda a cada montagem,
# depois das migrations e antes da semente. Travas de origem/destino iguais às do catalogos.sh e do semente-demo.sh.
set -euo pipefail
: "${PROD_DATABASE_URL:?PROD_DATABASE_URL ausente}" "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
PSQL="${PSQL:-psql}"
PROD_REF=horsymhsinqcimflrtjo
TEST_REF=xjzqndnvjkdjyisuklpy
erro() { echo "::error::$*"; exit 1; }
case "$TEST_DATABASE_URL" in *"$PROD_REF"*) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado";; esac
# vaga 0 = o projeto erp-psgestao-testes conhecido; vaga > 0 = qualquer Session pooler que NÃO seja a produção (mesma
# regra do catalogos.sh e do passo "Trava de segurança" do montar-banco-testes.yml; ACEITACAO_VAGA vem do GITHUB_ENV).
if [ "${ACEITACAO_VAGA:-0}" = 0 ]; then
  case "$TEST_DATABASE_URL" in *"$TEST_REF"*) ;; *) erro "TEST_DATABASE_URL não é o projeto erp-psgestao-testes";; esac
else
  case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) erro "vaga ${ACEITACAO_VAGA}: TEST_DATABASE_URL precisa ser Session pooler (*.pooler.supabase.com)";; esac
fi
case "$PROD_DATABASE_URL" in *"$PROD_REF"*) ;; *) erro "PROD_DATABASE_URL não é o projeto de produção";; esac
case "$PROD_DATABASE_URL" in *"$TEST_REF"*) erro "PROD_DATABASE_URL aponta para o banco de testes";; esac

dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
here=$(cd "$(dirname "$0")" && pwd)

# Produção: só leitura (timeout curto). Uma linha = um comando, na ordem do arquivo .sql.
{ echo "SET statement_timeout='30s';"; cat "$here/espelhar-grants.sql"; } \
  | "$PSQL" "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -At -q > "$dir/cmds.txt"
n=$(grep -c . "$dir/cmds.txt" || true)
echo "espelhar-grants: $n comando(s) lidos da produção"
[ "$n" -gt 1000 ] || erro "espelhar-grants: poucos comandos ($n) — leitura da produção incompleta"

# Teste: transação única; objeto que não existe (migration ainda não aplicada) é pulado e contado, nunca silenciado.
cat > "$dir/carga.sql" <<SQL
BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;
CREATE TEMP TABLE _acl (id bigserial PRIMARY KEY, stmt text NOT NULL) ON COMMIT DROP;
\copy _acl(stmt) FROM '$dir/cmds.txt' WITH (FORMAT csv, DELIMITER E'\x02', QUOTE E'\x01')
DO \$\$
DECLARE r record; ok int := 0; pulados int := 0; falhas int := 0;
BEGIN
  FOR r IN SELECT stmt FROM _acl ORDER BY id LOOP
    BEGIN
      EXECUTE r.stmt; ok := ok + 1;
    EXCEPTION
      WHEN undefined_function OR undefined_table OR undefined_column OR undefined_object THEN pulados := pulados + 1;
      WHEN OTHERS THEN
        falhas := falhas + 1;
        IF falhas <= 10 THEN RAISE WARNING 'falhou: % -> % (%)', left(r.stmt, 160), SQLERRM, SQLSTATE; END IF;
    END;
  END LOOP;
  RAISE NOTICE 'espelhar-grants: aplicados=% pulados(objeto ausente no teste)=% falhas=%', ok, pulados, falhas;
  IF falhas > 20 THEN RAISE EXCEPTION 'espelhar-grants: % falhas (>20) — revisar', falhas; END IF;
END \$\$;
COMMIT;
SQL
"$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/carga.sql"

# Conferência (RD-38): quantas funções o anon EXECUTA DE FATO — produção × teste, medidas do MESMO jeito (privilégio
# efetivo via has_function_privilege, que inclui o EXECUTE default de PUBLIC). A versão anterior contava a produção
# grepando só os GRANTs EXPLÍCITOS do dump (TO anon|PUBLIC) → não via o EXECUTE default de PUBLIC e dava 26, enquanto o
# teste usava has_function_privilege e dava 61. Era divergência só de MEDIÇÃO (prod e teste têm os mesmos 61 — provado no
# dado): o guarda derrubava o montar ANTES da semente, a vaga ficava sem dado e os testes morriam em <5 min ("vaga
# doente"). É UMA agregação no catálogo (pg_proc, ~1,9k linhas) com timeout curto — não é "função por linha em volume"
# do incidente 03/10 (aquele chamava função auxiliar por linha de tabela grande, 365 mil vezes).
anon_prod=$("$PSQL" "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "set statement_timeout='30s'; select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p') and has_function_privilege('anon', p.oid, 'EXECUTE')")
anon_teste=$("$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p') and has_function_privilege('anon', p.oid, 'EXECUTE')")
echo "funções executáveis pelo anon — produção: $anon_prod · teste: $anon_teste"
dif=$(( anon_teste > anon_prod ? anon_teste - anon_prod : anon_prod - anon_teste ))
[ "$dif" -le 10 ] || erro "espelhar-grants: anon executa $anon_teste funções no teste × $anon_prod na produção — direitos não espelhados"
{
  echo "### Direitos espelhados da produção (schema public)"
  echo "| comandos lidos | anon executa (prod) | anon executa (teste) |"
  echo "|---|---|---|"
  echo "| $n | $anon_prod | $anon_teste |"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "espelhar-grants: ok"
