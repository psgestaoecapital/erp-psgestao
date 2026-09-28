-- Telemetria de travamento sem sessão (CEO 28/09: "SIM, libere para anônimo com limite").
-- Antes: fn_registrar_travamento exigia sessão → navegador sem login (tela de login travada, sessão caída)
-- recebia 401 a cada ~5 min e o travamento se perdia — justo os que mais importam (RD-87: login parou 1 min).
-- Agora: anon grava, com o MESMO limite já existente (fn_telemetria_estourou: no máximo 20 gravações por
-- minuto por usuário ou, sem usuário, por IP de origem). Sem sessão a empresa nunca é gravada (v_comp fica nulo:
-- get_user_company_ids do anon é vazio). Só a assinatura de 7 argumentos (a que o app chama) vai ao anon.
-- ci-allow-anon: telemetria de travamento antes do login; limite de 20/min por IP (fn_telemetria_estourou)

CREATE OR REPLACE FUNCTION public.fn_registrar_travamento(p_label text, p_duracao_ms integer DEFAULT NULL::integer,
  p_timeout boolean DEFAULT false, p_company_id uuid DEFAULT NULL::uuid, p_user_agent text DEFAULT NULL::text,
  p_rota text DEFAULT NULL::text, p_bundle_version text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_comp uuid := NULL;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_ip text := public.fn_telemetria_ip_origem();
BEGIN
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RETURN NULL;
  END IF;
  -- limite por origem (CEO 28/09): 20/min por usuário ou, sem sessão, por IP
  IF NOT v_interno AND public.fn_telemetria_estourou(v_uid, v_ip) THEN
    RETURN NULL;
  END IF;
  IF p_company_id IS NOT NULL AND v_uid IS NOT NULL AND (is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    v_comp := p_company_id;
  ELSIF p_company_id IS NOT NULL AND (v_interno OR auth.role()='service_role') THEN
    v_comp := p_company_id;
  END IF;
  INSERT INTO erp_carregamento_travamento (usuario_id, company_id, label, duracao_ms, timeout, user_agent, tipo, rota, bundle_version, origem_ip)
  VALUES (v_uid, v_comp, left(p_label, 120), p_duracao_ms, coalesce(p_timeout, false), left(p_user_agent, 300),
          'carregamento', left(p_rota, 200), left(p_bundle_version, 60), left(v_ip, 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

REVOKE ALL ON FUNCTION public.fn_registrar_travamento(text,integer,boolean,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_registrar_travamento(text,integer,boolean,uuid,text,text,text) TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.fn_registrar_travamento(text,integer,boolean,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'telemetria: anon sem EXECUTE em fn_registrar_travamento';
  END IF;
  IF pg_get_functiondef('public.fn_registrar_travamento(text,integer,boolean,uuid,text,text,text)'::regprocedure) !~ 'fn_telemetria_estourou' THEN
    RAISE EXCEPTION 'telemetria: limite por origem ausente';
  END IF;
END $$;
