-- 🚨 SEGURANÇA · PR 1 de 3 (CEO 28/09) — tabelas de PERMISSÃO e ACESSO sem RLS e com GRANT total ao anon.
--
-- 92 tabelas sem RLS tinham GRANT de SELECT/INSERT/UPDATE/DELETE/TRUNCATE para anon: a varredura anterior
-- (fn_seguranca_rls_auditar) só olhava tabela com company_id, e nenhuma destas tem. Esta PR fecha as 10 que
-- mandam no sistema — quem pode o quê, planos, módulos e menu:
--   role_permissions, rbac_papel, rbac_papel_acesso, rbac_subgrupo_catalogo, access_config,
--   plan_modules, plan_catalog, module_catalog, screen_route_features, area_menu_config.
--
-- Tratamento (igual para as 10):
--   • REVOKE ALL de anon (nem leitura, nem escrita, nem TRUNCATE);
--   • authenticated mantém SÓ SELECT (o app lê menu, planos e permissões) — INSERT/UPDATE/DELETE/TRUNCATE revogados;
--   • RLS ligada + policy de SELECT para authenticated; escrita só por service_role (BYPASSRLS) e pelas funções
--     SECURITY DEFINER do dono (menu, permissões, criação de empresa — todas já são DEFINER).
--
-- Junto, porque sem isso a escrita continuaria aberta por outra porta:
--   • fn_vincular_modulo_aos_planos (ESCREVE plan_modules) e fn_recalcular_pct_evolucao_areas (ESCREVE
--     area_menu_config) eram SECURITY DEFINER sem guarda e executáveis por anon. A 1ª só é chamada pelo gatilho
--     fn_trg_modulo_vincular_planos (DEFINER, roda como dono); a 2ª não tem chamador no app. → só service_role.
--   • access_config era gravada DIRETO pela tela Admin (liga/desliga e horário por papel). Passa a gravar por
--     fn_access_config_salvar (SECURITY DEFINER, só is_admin()) — a tabela segue sem escrita para o app.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['role_permissions','rbac_papel','rbac_papel_acesso','rbac_subgrupo_catalogo','access_config',
                           'plan_modules','plan_catalog','module_catalog','screen_route_features','area_menu_config']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select_authenticated', t);
  END LOOP;
END $$;

-- escrita sem guarda que continuava aberta ao anon
REVOKE ALL ON FUNCTION public.fn_vincular_modulo_aos_planos(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_vincular_modulo_aos_planos(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_recalcular_pct_evolucao_areas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recalcular_pct_evolucao_areas() TO service_role;

-- Admin → Acessos: regra de horário/ativo por papel (tabela global, sem company_id) — só administrador PS.
CREATE OR REPLACE FUNCTION public.fn_access_config_salvar(p_role text, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao');
  END IF;
  IF COALESCE(btrim(p_role), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'papel_obrigatorio');
  END IF;

  SELECT id INTO v_id FROM access_config WHERE role = p_role ORDER BY created_at LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO access_config (role, horario_inicio, horario_fim, dias_semana, timeout_minutos, ativo)
    VALUES (p_role,
      COALESCE(NULLIF(p_dados->>'horario_inicio', ''), '00:00'),
      COALESCE(NULLIF(p_dados->>'horario_fim', ''), '23:59'),
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_dados->'dias_semana') x), ARRAY['seg','ter','qua','qui','sex','sab','dom']),
      COALESCE(NULLIF(p_dados->>'timeout_minutos', '')::int, 30),
      COALESCE((p_dados->>'ativo')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE access_config SET
      horario_inicio  = CASE WHEN p_dados ? 'horario_inicio'  THEN NULLIF(p_dados->>'horario_inicio', '') ELSE horario_inicio END,
      horario_fim     = CASE WHEN p_dados ? 'horario_fim'     THEN NULLIF(p_dados->>'horario_fim', '')    ELSE horario_fim END,
      dias_semana     = CASE WHEN p_dados ? 'dias_semana'
                             THEN (SELECT array_agg(x) FROM jsonb_array_elements_text(p_dados->'dias_semana') x) ELSE dias_semana END,
      timeout_minutos = CASE WHEN p_dados ? 'timeout_minutos' THEN NULLIF(p_dados->>'timeout_minutos', '')::int ELSE timeout_minutos END,
      ativo           = CASE WHEN p_dados ? 'ativo' THEN (p_dados->>'ativo')::boolean ELSE ativo END,
      updated_at      = now()
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_access_config_salvar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_access_config_salvar(text, jsonb) TO authenticated, service_role;
