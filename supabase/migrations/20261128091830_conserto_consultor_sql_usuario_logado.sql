-- =====================================================================
-- conserto-main(consultor-ia): fn_consultor_sql roda para o usuário logado (dono postgres + execução no papel de leitura)
--
-- BUG (provado em produção pelo Eng. Chefe, papel authenticated, usuário da Pdois, transação revertida):
--   select fn_consultor_sql('36b69d77-…','select … from titulos …') → ERROR 42501 permission denied for schema auth
--   (linha de auth.uid()). Causa: public.fn_consultor_sql é SECURITY DEFINER com dono = consultor_leitor, que NÃO tem
--   USAGE em auth (o GRANT USAGE ON SCHEMA auth não pega — o postgres não tem grant option em auth). Logo auth.uid() e
--   get_user_company_ids() falham em TODA chamada e o Consultor nunca responde ao usuário logado.
--
-- CORREÇÃO: a VALIDAÇÃO de identidade/acesso + a guarda de injeção + o bind + o log passam a rodar como POSTGRES (que tem
--   auth); a EXECUÇÃO da consulta continua no PAPEL DE LEITURA (consultor_leitor — só as views do schema consultor, sem
--   public), agora isolada em consultor.fn_exec. O sandbox é idêntico ao de antes (a query roda como consultor_leitor);
--   só a parte que precisa de auth saiu do papel de leitura. consultor/public não são tabela de domínio (RD-97 ok).
-- =====================================================================

-- 1) consultor.fn_exec: executa a consulta JÁ VALIDADA no papel de LEITURA (dono = consultor_leitor). Não valida nada
--    (quem valida é a public.fn_consultor_sql, antes). Só lê o que consultor_leitor enxerga (as views do consultor).
CREATE OR REPLACE FUNCTION consultor.fn_exec(p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = consultor, pg_catalog
AS $fn$
DECLARE v_res jsonb;
BEGIN
  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM ( SELECT * FROM ( %s ) AS _q LIMIT 200 ) AS t', p_sql)
    INTO v_res;
  RETURN COALESCE(v_res, '[]'::jsonb);
END; $fn$;

-- dono = consultor_leitor (precisa de CREATE no schema só para o momento do ALTER OWNER; postgres é membro de
-- consultor_leitor, por isso o ALTER OWNER é permitido). Depois tira o CREATE de volta.
GRANT CREATE ON SCHEMA consultor TO consultor_leitor;
ALTER FUNCTION consultor.fn_exec(text) OWNER TO consultor_leitor;
REVOKE CREATE ON SCHEMA consultor FROM consultor_leitor;
-- Só a public.fn_consultor_sql (que roda como postgres) chama a fn_exec; ninguém mais.
REVOKE ALL ON FUNCTION consultor.fn_exec(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consultor.fn_exec(text) TO postgres;

-- 2) public.fn_consultor_sql: DONO = postgres (DROP + CREATE, SEM ALTER OWNER — o ALTER OWNER do público já quebrou o
--    deploy antes, #6219). Roda como postgres → auth.uid()/get_user_company_ids()/is_admin() funcionam. Mantém TUDO:
--    valida a empresa, guarda de injeção (recusa ';' exceto um final, '--', '/*' e o que não começa com SELECT/WITH),
--    amarra a empresa com consultor.fn_bind, loga com consultor.fn_log — e delega a execução a consultor.fn_exec.
DROP FUNCTION IF EXISTS public.fn_consultor_sql(uuid, text, uuid);
CREATE FUNCTION public.fn_consultor_sql(p_company_id uuid, p_sql text, p_pergunta_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'consultor', 'pg_catalog'
AS $fn$
DECLARE v_res jsonb; v_rows int; v_ini timestamptz := clock_timestamp(); v_ms int; v_sql text;
BEGIN
  IF auth.uid() IS NULL AND coalesce(current_setting('request.jwt.claims', true), '') <> '' THEN
    RAISE EXCEPTION 'consultor: sessão sem usuário' USING errcode = '42501';
  END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'consultor: sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  IF p_sql IS NULL OR btrim(p_sql) = '' THEN RETURN '[]'::jsonb; END IF;

  -- GUARDA DE INJEÇÃO no banco (auditoria #6221 · 2ª linha, além do parser do Node): o EXECUTE de plpgsql aceita
  -- MÚLTIPLOS comandos. Recusa ';' (menos um único final, removido), '--' e '/*'; exige começar com SELECT/WITH.
  v_sql := btrim(p_sql);
  IF right(v_sql, 1) = ';' THEN v_sql := btrim(left(v_sql, length(v_sql) - 1)); END IF;
  IF strpos(v_sql, ';') > 0 OR strpos(v_sql, '--') > 0 OR strpos(v_sql, '/*') > 0 THEN
    RAISE EXCEPTION 'consultor: consulta inválida (um único SELECT, sem ";" ou comentários)' USING errcode = '42501';
  END IF;
  IF v_sql !~* '^(select|with)\s' THEN
    RAISE EXCEPTION 'consultor: só SELECT/WITH' USING errcode = '42501';
  END IF;

  PERFORM consultor.fn_bind(p_company_id);        -- amarra empresa × txid (visível à fn_exec, mesma transação)
  -- Teto de tempo: o cap efetivo é o statement_timeout do papel chamador (authenticated = 8s), armado no comando de
  -- topo; o SET LOCAL aqui vale como 2ª linha. O parser do Node (T1) já barra pg_sleep/funções voláteis antes.
  SET LOCAL statement_timeout = '5s';
  BEGIN
    v_res := consultor.fn_exec(v_sql);           -- EXECUÇÃO no papel de leitura (consultor_leitor)
  EXCEPTION WHEN OTHERS THEN
    v_ms := (extract(epoch FROM (clock_timestamp() - v_ini)) * 1000)::int;
    PERFORM consultor.fn_log(p_sql, NULL, v_ms, SQLERRM, p_pergunta_id);
    RETURN jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE);
  END;
  v_rows := jsonb_array_length(COALESCE(v_res, '[]'::jsonb));
  v_ms := (extract(epoch FROM (clock_timestamp() - v_ini)) * 1000)::int;
  PERFORM consultor.fn_log(p_sql, v_rows, v_ms, NULL, p_pergunta_id);
  RETURN jsonb_build_object('linhas', v_rows, 'truncado', (v_rows >= 200), 'ms', v_ms, 'dados', COALESCE(v_res, '[]'::jsonb));
END; $fn$;

-- Entrada só para usuário logado (ou serviço); nunca anon/PUBLIC.
REVOKE ALL ON FUNCTION public.fn_consultor_sql(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_sql(uuid, text, uuid) TO authenticated, service_role;
