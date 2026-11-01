#!/usr/bin/env bash
# Acerta os contadores (sequences) do schema public no banco de TESTES depois de copiar linhas com id explícito
# (catálogos da produção) ou de restaurar a vaga: setval(seq, max(coluna)) quando max >= last_value.
# Sem isto a próxima inserção gera id já usado ("duplicate key ... _pkey (id)=(9)", vaga 1 em 14/10, #2533).
# Uso: TEST_DATABASE_URL=... [PSQL=psql] scripts/banco-testes/acertar-sequences.sh   (nunca roda na produção)
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
PSQL="${PSQL:-psql}"
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado"; exit 1;; esac
"$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
SET statement_timeout = '2min';
DO $acerta$
DECLARE r record; mx bigint; n int := 0;
BEGIN
  FOR r IN
    SELECT format('%I.%I', sn.nspname, s.relname) AS seq, format('%I.%I', tn.nspname, t.relname) AS tab,
           quote_ident(a.attname) AS col, ps.last_value
    FROM pg_depend d
    JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
    JOIN pg_namespace sn ON sn.oid = s.relnamespace
    JOIN pg_class t ON t.oid = d.refobjid AND t.relkind IN ('r','p')
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    JOIN pg_sequences ps ON ps.schemaname = sn.nspname AND ps.sequencename = s.relname
    WHERE d.deptype IN ('a','i') AND tn.nspname = 'public' AND a.atttypid IN ('int2'::regtype,'int4'::regtype,'int8'::regtype)
  LOOP
    EXECUTE format('SELECT max(%s) FROM %s', r.col, r.tab) INTO mx;
    IF mx IS NOT NULL AND mx >= coalesce(r.last_value, 0) THEN
      PERFORM setval(r.seq, mx, true); n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'sequences acertadas: %', n;
END
$acerta$;
SQL
