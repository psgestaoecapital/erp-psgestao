-- Acerta os contadores (sequences) do schema public no BANCO DE TESTES depois de copiar linhas COM id da produção
-- (catálogos, restauração): a cópia não avança a sequence e a próxima inserção gerava id já usado
-- ("duplicate key screen_route_features_pkey (id)=(9)", 14/10). Só avança (nunca recua): setval só quando max >= last_value.
-- Só toca sequence ligada a coluna (serial/identity) de tabela do public. Nunca roda na produção.
DO $$
DECLARE r record; m bigint; n int := 0;
BEGIN
  FOR r IN
    SELECT s.oid::regclass AS seq, s.relname, d.refobjid::regclass AS tab, a.attname AS col
    FROM pg_class s
    JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
    JOIN pg_class t ON t.oid = d.refobjid AND t.relkind IN ('r', 'p')
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    WHERE s.relkind = 'S' AND s.relnamespace = 'public'::regnamespace AND t.relnamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('SELECT max(%I) FROM %s', r.col, r.tab) INTO m;
    IF m IS NOT NULL AND m >= (SELECT coalesce(max(last_value), 0) FROM pg_sequences WHERE schemaname = 'public' AND sequencename = r.relname) THEN
      PERFORM setval(r.seq, m);
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'sequences acertadas: %', n;
END $$;
