-- P0 · APP PS NO CELULAR (contextos 16bc8561 / 147694b7) — telemetria de AUTH + build id
--
-- O celular do CEO perdeu o login em segundo plano (timers congelados → autoRefreshToken não roda →
-- token vence → volta como VISITANTE). Para enxergar isso no dado (RD-38) o painel de travamentos
-- precisa registrar eventos de AUTH (TOKEN_REFRESHED, refresh_falhou, SIGNED_OUT, sessao_ausente),
-- com rota e versão do bundle — inclusive QUANDO NÃO HÁ SESSÃO (é justamente o caso a capturar).
--
-- 1) erp_carregamento_travamento ganha tipo/rota/bundle_version (retrocompatível; default 'carregamento').
-- 2) fn_registrar_travamento passa a aceitar rota+bundle (segue exigindo sessão — evento de carregamento).
-- 3) fn_registrar_evento_auth (NOVA): grava tipo='auth' e é executável por anon — sem isso o evento
--    mais importante (perdi a sessão) nunca seria gravado. Superfície mínima: só insere telemetria.

-- ── 1) Colunas novas (idempotente) ────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_carregamento_travamento
  ADD COLUMN IF NOT EXISTS tipo           text NOT NULL DEFAULT 'carregamento',
  ADD COLUMN IF NOT EXISTS rota           text,
  ADD COLUMN IF NOT EXISTS bundle_version text;

-- ── 2) fn_registrar_travamento — agora grava rota + bundle_version ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_registrar_travamento(
  p_label text,
  p_duracao_ms integer DEFAULT NULL::integer,
  p_timeout boolean DEFAULT false,
  p_company_id uuid DEFAULT NULL::uuid,
  p_user_agent text DEFAULT NULL::text,
  p_rota text DEFAULT NULL::text,
  p_bundle_version text DEFAULT NULL::text
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_comp uuid := NULL;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR v_uid IS NOT NULL) THEN
    RAISE EXCEPTION 'Sessão necessária' USING errcode='42501';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RETURN NULL;
  END IF;
  IF p_company_id IS NOT NULL AND (v_interno OR auth.role()='service_role' OR is_admin()
        OR p_company_id IN (SELECT get_user_company_ids())) THEN
    v_comp := p_company_id;
  END IF;
  INSERT INTO erp_carregamento_travamento (usuario_id, company_id, label, duracao_ms, timeout, user_agent, tipo, rota, bundle_version)
  VALUES (v_uid, v_comp, left(p_label, 120), p_duracao_ms, coalesce(p_timeout, false), left(p_user_agent, 300),
          'carregamento', left(p_rota, 200), left(p_bundle_version, 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

-- ── 3) fn_registrar_evento_auth — tipo='auth', PERMITE anon (captura a perda de sessão) ────────────
CREATE OR REPLACE FUNCTION public.fn_registrar_evento_auth(
  p_label text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_user_agent text DEFAULT NULL::text,
  p_rota text DEFAULT NULL::text,
  p_bundle_version text DEFAULT NULL::text
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();  -- pode ser NULL (é o ponto: registrar quando NÃO há sessão)
  v_comp uuid := NULL;
BEGIN
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RETURN NULL;
  END IF;
  -- company_id só se pertencer ao usuário (quando há sessão); anon nunca atribui empresa.
  IF p_company_id IS NOT NULL AND v_uid IS NOT NULL
     AND (is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    v_comp := p_company_id;
  END IF;
  INSERT INTO erp_carregamento_travamento (usuario_id, company_id, label, duracao_ms, timeout, user_agent, tipo, rota, bundle_version)
  VALUES (v_uid, v_comp, left(p_label, 120), 0, false, left(p_user_agent, 300),
          'auth', left(p_rota, 200), left(p_bundle_version, 60))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

REVOKE ALL ON FUNCTION public.fn_registrar_evento_auth(text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_registrar_evento_auth(text, uuid, text, text, text) TO anon, authenticated, service_role;
