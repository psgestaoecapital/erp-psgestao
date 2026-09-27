-- 🚨 SEGURANÇA · PR 3 de 3 (CEO 28/09) — backups, debug e auditoria interna: 46 tabelas sem RLS e com GRANT total
-- ao anon (inclusive DELETE/TRUNCATE). Tratamento: RLS ligada; REVOKE ALL de anon; authenticated sem escrita.
-- service_role, funções SECURITY DEFINER do dono e o SQL do dono seguem lendo/gravando (não passam pela RLS).
-- NADA é apagado (RD-30) — inclusive os backups bkp_* / _rbac_bkp_*.
--
-- (A) TELA INTERNA PS — leitura só para administrador PS (is_admin(): users.role adm/acesso_total), invisível ao
--     cliente (decisão do CEO 28/09): system_screens, system_screens_insights (Painel de Auditores /admin/auditores),
--     manual_vivo_diario (/dashboard/manual-vivo) e ge_* (roadmap da GE).
-- (B) SEM POLICY — invisíveis ao app (0 linhas para o logado; anon sem privilégio). Mapeado no código: só rotas de
--     API com service_role (gold_*, system_screens_history, v_ia_saude no NOC) e funções DEFINER / SQL do dono
--     (briefing, handoff, auditores) usam estas tabelas.
--     _admin_*, _debug_*, _probe_*, _rbac_*, area_indicadores_mestres/principios/secao_ordem/visao_estrategica
--     (as telas de metas/indicadores leem por RPC DEFINER), bkp_*, erp_handoff_sessao, gold_*, manual_operacional,
--     pem_*, rd38_*, system_screens_history, system_screens_taxonomia.
-- As 3 funções SECURITY INVOKER que leem estas tabelas (fn_auditor_telas_orfas_menu, fn_ge_briefing_roadmap,
-- fn_ge_status_atual) não são chamadas pelo app: rodam no SQL do dono / dentro do briefing.

DO $$
DECLARE t text;
  todas text[] := ARRAY[
    '_admin_dividas_tecnicas','_admin_padroes_arquitetura',
    '_debug_horas_cru','_debug_horas_test','_debug_iopoint_test','_debug_synclog','_debug_th2','_probe_iopoint',
    '_rbac_bkp_permissoes','_rbac_bkp_permissoes_t1','_rbac_bkp_users','_rbac_menu_snap',
    'area_indicadores_mestres','area_principios','area_secao_ordem','area_visao_estrategica',
    'bkp_acesso_jordana_20260825','bkp_clientes_enquadramento_20260923','bkp_nfe_status_kgf_20260825',
    'bkp_parcela_grupo_backfill_20260810','bkp_umuarama_categoria_20260923',
    'erp_handoff_sessao',
    'ge_checkpoints_validacao','ge_features_por_tier','ge_roadmap_ondas','ge_roadmap_prs','ge_tiers_comerciais',
    'gold_botoes_destinos_audit','gold_camada2_validacoes','gold_dom_enumerations','gold_screen_buttons','gold_veredito_triplo',
    'manual_operacional','manual_vivo_diario',
    'pem_concorrentes_benchmark','pem_diferenciais_unicos','pem_funcionalidades_match','pem_roadmap_ondas','pem_roadmap_prs',
    'rd38_cron_falhas','rd38_insight_rejeicoes','rd38_playwright_falhas',
    'system_screens','system_screens_history','system_screens_insights','system_screens_taxonomia'];
  admin_le text[] := ARRAY[
    'system_screens','system_screens_insights','manual_vivo_diario',
    'ge_checkpoints_validacao','ge_features_por_tier','ge_roadmap_ondas','ge_roadmap_prs','ge_tiers_comerciais'];
BEGIN
  FOREACH t IN ARRAY todas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
  -- (A) leitura só administrador PS
  FOREACH t IN ARRAY admin_le LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin_ps', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin())', t || '_select_admin_ps', t);
  END LOOP;
END $$;
