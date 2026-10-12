-- Gera (SÓ LEITURA, catálogo do Postgres — nenhum dado de tabela) os comandos que fazem os GRANTs/REVOKEs do banco de
-- TESTES ficarem idênticos aos da produção: schema public, tabelas/views/sequências (inclusive por coluna) e funções.
-- Uma linha = um comando. Roda na PRODUÇÃO por scripts/banco-testes/espelhar-grants.sh e o resultado é aplicado no teste.
-- Sem função por linha em volume: só catálogo (≈ 7 mil linhas) e regprocedure::text por função (≈ 1,9 mil).
SET search_path = public, pg_catalog;

-- schema
SELECT format('REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role');
SELECT format('GRANT %s ON SCHEMA public TO %s', string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type),
              CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END)
FROM pg_namespace n, aclexplode(n.nspacl) a
WHERE n.nspname = 'public' AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
GROUP BY a.grantee;

-- tabelas, views, views materializadas, tabelas estrangeiras e sequências: zera e regrava
SELECT format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role',
              CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, c.oid::regclass)
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e');

SELECT format('GRANT %s ON %s %s TO %s', string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type),
              CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, c.oid::regclass,
              CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END)
FROM pg_class c, aclexplode(c.relacl) a
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
GROUP BY c.oid, c.relkind, a.grantee;

-- direito por coluna (LGPD salário/custo): vem DEPOIS do direito da tabela
SELECT format('GRANT %s (%s) ON TABLE %s TO %s', x.priv, string_agg(quote_ident(x.attname), ', ' ORDER BY x.attnum), x.rel,
              x.grantee_nome)
FROM (
  SELECT a.privilege_type AS priv, t.attname, t.attnum, t.attrelid::regclass AS rel,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee_nome
  FROM pg_attribute t
  JOIN pg_class c ON c.oid = t.attrelid AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  CROSS JOIN LATERAL aclexplode(t.attacl) a
  WHERE t.attacl IS NOT NULL AND t.attnum > 0 AND NOT t.attisdropped
    AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
) x
GROUP BY x.priv, x.rel, x.grantee_nome;

-- funções e procedimentos: ACL nula = padrão do Postgres (EXECUTE para PUBLIC)
SELECT format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role',
              CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, p.oid::regprocedure)
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

SELECT format('GRANT EXECUTE ON %s %s TO PUBLIC', CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, p.oid::regprocedure)
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p') AND p.proacl IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');

SELECT format('GRANT EXECUTE ON %s %s TO %s', CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, p.oid::regprocedure,
              CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END)
FROM pg_proc p, aclexplode(p.proacl) a
WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
  AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
