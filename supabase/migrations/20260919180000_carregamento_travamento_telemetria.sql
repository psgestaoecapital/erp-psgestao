-- P0 (16bc8561) · "registro de travamentos": telemetria leve de carregamentos que penduram/estouram
-- prazo no cliente. O comPrazo() destrava a tela; esta tabela dá VISIBILIDADE de quando/onde isso
-- acontece (qual etapa, quanto tempo, timeout ou só lento), para o CEO/Eng. Chefe agir no dado (RD-38).
-- Custo zero (RD-42): tabela minúscula, escrita fire-and-forget. Nasce blindada: REVOKE anon + guarda.

CREATE TABLE IF NOT EXISTS public.erp_carregamento_travamento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  usuario_id  uuid,                          -- setado no servidor (auth.uid()), nunca confiado do cliente
  company_id  uuid,                          -- só gravado se for empresa do usuário (senão NULL)
  label       text NOT NULL,                 -- etapa: dashboard_index_areas, areas_rpc, sidebar_modulos...
  duracao_ms  integer,
  timeout     boolean NOT NULL DEFAULT false, -- true = estourou o prazo (pendurou); false = só lento
  user_agent  text
);

-- Consulta do painel filtra por criado_em (janela 24h) e agrupa por label.
CREATE INDEX IF NOT EXISTS idx_carregamento_travamento_criado_em
  ON public.erp_carregamento_travamento (criado_em DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- WRITER · qualquer usuário logado registra o PRÓPRIO travamento. anon não executa
-- (REVOKE). usuario_id = auth.uid() (servidor). company_id só entra se for do usuário.
CREATE OR REPLACE FUNCTION public.fn_registrar_travamento(
  p_label text,
  p_duracao_ms integer DEFAULT NULL,
  p_timeout boolean DEFAULT false,
  p_company_id uuid DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_comp uuid := NULL;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  -- Precisa de sessão (ou ser interno/service_role). anon já está sem EXECUTE; isto é defesa em profundidade.
  IF NOT (v_interno OR auth.role()='service_role' OR v_uid IS NOT NULL) THEN
    RAISE EXCEPTION 'Sessão necessária' USING errcode='42501';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RETURN NULL; -- telemetria sem rótulo não serve; descarta em silêncio
  END IF;
  -- company_id só é gravado se for de fato uma empresa do usuário (evita poluir/atribuir errado).
  IF p_company_id IS NOT NULL AND (v_interno OR auth.role()='service_role' OR is_admin()
        OR p_company_id IN (SELECT get_user_company_ids())) THEN
    v_comp := p_company_id;
  END IF;
  INSERT INTO erp_carregamento_travamento (usuario_id, company_id, label, duracao_ms, timeout, user_agent)
  VALUES (v_uid, v_comp, left(p_label, 120), p_duracao_ms, coalesce(p_timeout, false), left(p_user_agent, 300))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_travamento(text, integer, boolean, uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_travamento(text, integer, boolean, uuid, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- LEITURA (painel) · agregado por etapa na janela. Só ADMIN (adm/acesso_total) ou
-- equipe PS (system_role PS_ADMIN/PS_ADMIN_CVM) — é dado operacional interno da PS.
CREATE OR REPLACE FUNCTION public.fn_travamentos_resumo(
  p_desde timestamptz DEFAULT (now() - interval '24 hours')
) RETURNS TABLE (
  label text, total bigint, timeouts bigint, max_ms integer, avg_ms integer, ultimo timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_ps boolean := EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM'));
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin() OR v_ps) THEN
    RAISE EXCEPTION 'Sem acesso' USING errcode='42501';
  END IF;
  RETURN QUERY
  SELECT t.label,
         count(*)::bigint,
         count(*) FILTER (WHERE t.timeout)::bigint,
         max(t.duracao_ms)::integer,
         round(avg(t.duracao_ms))::integer,
         max(t.criado_em)
  FROM erp_carregamento_travamento t
  WHERE t.criado_em >= p_desde
  GROUP BY t.label
  ORDER BY count(*) DESC, max(t.criado_em) DESC;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.fn_travamentos_resumo(timestamptz) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_travamentos_resumo(timestamptz) TO authenticated, service_role;
