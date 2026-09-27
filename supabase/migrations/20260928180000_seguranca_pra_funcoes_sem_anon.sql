-- 🚨 SEGURANÇA · PR A (CEO 28/09) — funções executáveis por quem não está logado.
--
-- Antes: 1.031 das 1.345 funções SECURITY DEFINER do public (e 328 comuns) executáveis por anon — pelo GRANT
-- padrão a PUBLIC. SECURITY DEFINER roda como dono e pula a RLS: ~200 escreviam no banco sem guarda
-- (fn_backup_executar, fn_import_cadastro_v1, fn_sync_empresa, fn_mudanca_*, fn_rateio_calcular_mes...).
--
-- Depois: anon executa SÓ a lista aprovada pelo CEO (28/09):
--  (1) páginas públicas, todas exigem e conferem token no corpo:
--      fn_os_publico_aprovar · fn_odonto_proposta_por_token/_aceitar/_recusar · fn_compliance_epi_marcar_visualizado/
--      _confirmar_assinatura · fn_nr36_ciencia_marcar_visualizado/_confirmar_assinatura · fn_convite_ler (PR 5) ·
--      fn_portal_cliente_obter (NOVA — portal do cliente, que nunca funcionou: 51 links, 0 acessos) ·
--      fn_registrar_evento_auth (telemetria de login caído — agora com limite de 20/min por IP ou usuário).
--      Fora da lista: fn_registrar_travamento (já recusava anon por dentro) e o link do contador (a rota passa a
--      usar o cliente de serviço — anon nem vê fn_veic_perfil_convite_*).
--  (2) as 11 guardas das policies (contexto CRÍTICO 7cf4c7db — não mexer sem prova em todas as verticais):
--      get_user_company_ids, is_admin, is_client_owner, user_can_access_plant, fn_eh_ps_admin, fn_cofre_pode_acessar,
--      fn_acessos_pode_gerir, fn_pode_ver_fila_suporte, fn_ind_tem_permissao, fn_wealth_user_eh_operador,
--      fn_wealth_user_pode_ver_tudo — só leitura; sem login devolvem vazio/falso (sem elas, "0 linhas" vira erro).
-- authenticated e service_role mantêm EXATAMENTE o que tinham (GRANT explícito antes do REVOKE de PUBLIC).
-- Funções novas nascem sem PUBLIC/anon (default privileges do dono das migrations).
-- Sem LOCK TABLE (o db push roda fora de bloco de transação).

-- (a) telemetria: limite por origem
ALTER TABLE public.erp_carregamento_travamento ADD COLUMN IF NOT EXISTS origem_ip text;
CREATE INDEX IF NOT EXISTS ix_carreg_trav_ip_criado ON public.erp_carregamento_travamento (origem_ip, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_carreg_trav_usuario_criado ON public.erp_carregamento_travamento (usuario_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.fn_telemetria_ip_origem() RETURNS text
 LANGUAGE plpgsql STABLE SET search_path = public, extensions, pg_temp AS $$
DECLARE v text;
BEGIN
  BEGIN
    v := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN v := NULL;
  END;
  RETURN nullif(btrim(split_part(coalesce(v, ''), ',', 1)), '');
END $$;
REVOKE ALL ON FUNCTION public.fn_telemetria_ip_origem() FROM PUBLIC, anon, authenticated;

-- true = passou do limite (20 gravações no último minuto pela mesma origem)
CREATE OR REPLACE FUNCTION public.fn_telemetria_estourou(p_uid uuid, p_ip text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT count(*) >= 20 FROM (
    SELECT 1 FROM erp_carregamento_travamento t
    WHERE t.criado_em > now() - interval '1 minute'
      AND CASE WHEN p_uid IS NOT NULL THEN t.usuario_id = p_uid
               ELSE t.usuario_id IS NULL AND t.origem_ip IS NOT DISTINCT FROM p_ip END
    LIMIT 20) x
$$;
REVOKE ALL ON FUNCTION public.fn_telemetria_estourou(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_registrar_evento_auth(p_label text, p_company_id uuid DEFAULT NULL::uuid, p_user_agent text DEFAULT NULL::text, p_rota text DEFAULT NULL::text, p_bundle_version text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();  -- pode ser NULL (é o ponto: registrar quando NÃO há sessão)
  v_comp uuid := NULL;
  v_ip text := public.fn_telemetria_ip_origem();
BEGIN
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RETURN NULL;
  END IF;
  -- CEO 28/09: sem token, então limite por origem — 20/min por usuário (logado) ou por IP (anon). Excedeu: descarta.
  IF public.fn_telemetria_estourou(v_uid, v_ip) THEN
    RETURN NULL;
  END IF;
  IF p_company_id IS NOT NULL AND v_uid IS NOT NULL
     AND (is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    v_comp := p_company_id;
  END IF;
  INSERT INTO erp_carregamento_travamento (usuario_id, company_id, label, duracao_ms, timeout, user_agent, tipo, rota, bundle_version, origem_ip)
  VALUES (v_uid, v_comp, left(p_label, 120), 0, false, left(p_user_agent, 300),
          'auth', left(p_rota, 200), left(p_bundle_version, 60), left(v_ip, 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_registrar_travamento(p_label text, p_duracao_ms integer DEFAULT NULL::integer, p_timeout boolean DEFAULT false, p_company_id uuid DEFAULT NULL::uuid, p_user_agent text DEFAULT NULL::text, p_rota text DEFAULT NULL::text, p_bundle_version text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_comp uuid := NULL;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_ip text := public.fn_telemetria_ip_origem();
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR v_uid IS NOT NULL) THEN
    RAISE EXCEPTION 'Sessão necessária' USING errcode='42501';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RETURN NULL;
  END IF;
  IF NOT v_interno AND public.fn_telemetria_estourou(v_uid, v_ip) THEN
    RETURN NULL;
  END IF;
  IF p_company_id IS NOT NULL AND (v_interno OR auth.role()='service_role' OR is_admin()
        OR p_company_id IN (SELECT get_user_company_ids())) THEN
    v_comp := p_company_id;
  END IF;
  INSERT INTO erp_carregamento_travamento (usuario_id, company_id, label, duracao_ms, timeout, user_agent, tipo, rota, bundle_version, origem_ip)
  VALUES (v_uid, v_comp, left(p_label, 120), p_duracao_ms, coalesce(p_timeout, false), left(p_user_agent, 300),
          'carregamento', left(p_rota, 200), left(p_bundle_version, 60), left(v_ip, 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

-- (b) portal do cliente: leitura pelo token do link (a tela lia a tabela direto como anon e a RLS barrava tudo)
CREATE OR REPLACE FUNCTION public.fn_portal_cliente_obter(p_company_id uuid, p_token text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE r record;
BEGIN
  IF p_company_id IS NULL OR length(coalesce(p_token, '')) < 12 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido');
  END IF;
  SELECT f.id, f.dados_consolidados, f.link_portal_acessado_em INTO r
    FROM bpo_fechamento_mensal f
   WHERE f.company_id = p_company_id AND f.link_portal = p_token
   ORDER BY f.mes_referencia DESC LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido'); END IF;
  IF r.dados_consolidados IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_dados'); END IF;
  IF r.link_portal_acessado_em IS NULL THEN
    UPDATE bpo_fechamento_mensal SET link_portal_acessado_em = now() WHERE id = r.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'dados', r.dados_consolidados);
END $$;

-- (c) EXECUTE: anon só na lista; authenticated/service_role preservados
DO $$
DECLARE f record; n_rev int := 0; n_anon int := 0;
  excecoes text[] := ARRAY[
    'fn_os_publico_aprovar','fn_odonto_proposta_por_token','fn_odonto_proposta_aceitar','fn_odonto_proposta_recusar',
    'fn_compliance_epi_marcar_visualizado','fn_compliance_epi_confirmar_assinatura',
    'fn_nr36_ciencia_marcar_visualizado','fn_nr36_ciencia_confirmar_assinatura',
    'fn_convite_ler','fn_portal_cliente_obter','fn_registrar_evento_auth',
    'get_user_company_ids','is_admin','is_client_owner','user_can_access_plant','fn_eh_ps_admin','fn_cofre_pode_acessar',
    'fn_acessos_pode_gerir','fn_pode_ver_fila_suporte','fn_ind_tem_permissao','fn_wealth_user_eh_operador',
    'fn_wealth_user_pode_ver_tudo'];
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_ok
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')  -- não mexe em extensão
  LOOP
    IF f.auth_ok THEN EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO authenticated', f.sig); END IF;
    IF f.svc_ok THEN EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', f.sig); END IF;
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon', f.sig);
    n_rev := n_rev + 1;
    IF f.proname = ANY (excecoes) THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO anon', f.sig);
      n_anon := n_anon + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'PR A: % funções revistas; anon mantém % assinaturas', n_rev, n_anon;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- trava: fora da lista, nenhuma função executável por anon
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname <> ALL (ARRAY[
       'fn_os_publico_aprovar','fn_odonto_proposta_por_token','fn_odonto_proposta_aceitar','fn_odonto_proposta_recusar',
       'fn_compliance_epi_marcar_visualizado','fn_compliance_epi_confirmar_assinatura',
       'fn_nr36_ciencia_marcar_visualizado','fn_nr36_ciencia_confirmar_assinatura',
       'fn_convite_ler','fn_portal_cliente_obter','fn_registrar_evento_auth',
       'get_user_company_ids','is_admin','is_client_owner','user_can_access_plant','fn_eh_ps_admin','fn_cofre_pode_acessar',
       'fn_acessos_pode_gerir','fn_pode_ver_fila_suporte','fn_ind_tem_permissao','fn_wealth_user_eh_operador',
       'fn_wealth_user_pode_ver_tudo']);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'PR A: anon ainda executa: %', v; END IF;
END $$;
