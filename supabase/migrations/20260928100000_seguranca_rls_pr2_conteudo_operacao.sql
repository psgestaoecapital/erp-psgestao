-- 🚨 SEGURANÇA · PR 2 de 3 (CEO 28/09) — conteúdo e operação: 36 tabelas sem RLS e com GRANT total ao anon.
-- Tratamento comum: RLS ligada; REVOKE ALL de anon; authenticated sem escrita (salvo onde a tela grava, com regra);
-- service_role e funções SECURITY DEFINER do dono seguem lendo/gravando (não passam pela RLS).
-- Leitura para authenticated só onde o app (tela ou função SECURITY INVOKER) precisa, mapeado no código:
--
-- (A) CATÁLOGO — qualquer logado lê (dado de referência, sem empresa):
--     compliance_tipos_documento, epi_categoria, erp_banco_erro_catalogo, erp_banco_manifesto, fiscal_lc116_exige_obra,
--     import_preset_mapeamento, module_subgrupos, data_sources, dashboard_atalhos_default,
--     lgpd_bases_legais, lgpd_finalidades_tratamento, lgpd_versao_vigente.
-- (B) DADO DE EMPRESA sem company_id — segue a RLS da tabela-mãe (quem vê a mãe vê o filho):
--     bpo_mensagens → bpo_conversas (conversas de clientes; tela /bpo/conversas lê direto);
--     projetos_servicos_bom → projetos_servicos (o BomEditor grava direto; gatilhos de custo atualizam).
-- (C) INTERNO PS — só administrador (is_admin()): visual_truth_alerts (Admin lê e muda status), visual_audit_rules.
-- (D) SEM POLICY — invisível ao app; só service_role / funções DEFINER / SQL do dono:
--     anthropic_budget_control, auditoria_comparativa_resultado, bpo_user_skills, custos_industriais (API usa service),
--     dev_chat, erp_auditor_matriz_resultados, erp_crm_anexo_limpeza_log, erp_mapa_desenvolvimento, erp_mudancas,
--     erp_outbox_dead_letter, erp_progresso_roadmap, erp_referencias_sistemas, erp_validacao_pr,
--     feature_benchmark_competitivo, feature_objetivo_final, hooked_api_endpoints, hooked_depara,
--     lgpd_inventario_dados, robo_budget_config, robo_budget_consumo_diario.
--     O orçamento do robô era lido/gravado por funções SECURITY INVOKER chamadas pelo usuário logado (aiGuardedCall):
--     fn_budget_pode_executar / fn_budget_registrar_gasto / fn_budget_dashboard passam a SECURITY DEFINER (search_path
--     fixo, sem anon) — o usuário continua podendo consultar/registrar gasto, sem ganhar acesso às tabelas.
-- Nada é apagado.

DO $$
DECLARE t text;
  todas text[] := ARRAY[
    'compliance_tipos_documento','epi_categoria','erp_banco_erro_catalogo','erp_banco_manifesto','fiscal_lc116_exige_obra',
    'import_preset_mapeamento','module_subgrupos','data_sources','dashboard_atalhos_default',
    'lgpd_bases_legais','lgpd_finalidades_tratamento','lgpd_versao_vigente',
    'bpo_mensagens','projetos_servicos_bom','visual_truth_alerts','visual_audit_rules',
    'anthropic_budget_control','auditoria_comparativa_resultado','bpo_user_skills','custos_industriais','dev_chat',
    'erp_auditor_matriz_resultados','erp_crm_anexo_limpeza_log','erp_mapa_desenvolvimento','erp_mudancas',
    'erp_outbox_dead_letter','erp_progresso_roadmap','erp_referencias_sistemas','erp_validacao_pr',
    'feature_benchmark_competitivo','feature_objetivo_final','hooked_api_endpoints','hooked_depara',
    'lgpd_inventario_dados','robo_budget_config','robo_budget_consumo_diario'];
  catalogo text[] := ARRAY[
    'compliance_tipos_documento','epi_categoria','erp_banco_erro_catalogo','erp_banco_manifesto','fiscal_lc116_exige_obra',
    'import_preset_mapeamento','module_subgrupos','data_sources','dashboard_atalhos_default',
    'lgpd_bases_legais','lgpd_finalidades_tratamento','lgpd_versao_vigente'];
BEGIN
  FOREACH t IN ARRAY todas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
  -- (A) catálogo
  FOREACH t IN ARRAY catalogo LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select_authenticated', t);
  END LOOP;
END $$;

-- (B) segue a tabela-mãe (a subconsulta roda com a RLS da mãe: empresa do usuário ou admin PS)
GRANT SELECT ON TABLE public.bpo_mensagens TO authenticated;
DROP POLICY IF EXISTS bpo_mensagens_via_conversa ON public.bpo_mensagens;
CREATE POLICY bpo_mensagens_via_conversa ON public.bpo_mensagens FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bpo_conversas c WHERE c.id = bpo_mensagens.conversa_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projetos_servicos_bom TO authenticated;
DROP POLICY IF EXISTS projetos_servicos_bom_via_servico ON public.projetos_servicos_bom;
CREATE POLICY projetos_servicos_bom_via_servico ON public.projetos_servicos_bom FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projetos_servicos s WHERE s.id = projetos_servicos_bom.servico_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projetos_servicos s WHERE s.id = projetos_servicos_bom.servico_id));

-- (C) interno PS
GRANT SELECT, UPDATE ON TABLE public.visual_truth_alerts TO authenticated;
DROP POLICY IF EXISTS visual_truth_alerts_admin ON public.visual_truth_alerts;
CREATE POLICY visual_truth_alerts_admin ON public.visual_truth_alerts FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
GRANT SELECT ON TABLE public.visual_audit_rules TO authenticated;
DROP POLICY IF EXISTS visual_audit_rules_admin ON public.visual_audit_rules;
CREATE POLICY visual_audit_rules_admin ON public.visual_audit_rules FOR SELECT TO authenticated USING (is_admin());

-- (D) orçamento do robô: funções INVOKER chamadas pelo usuário logado → DEFINER (tabelas ficam fechadas)
ALTER FUNCTION public.fn_budget_pode_executar(numeric) SECURITY DEFINER;
ALTER FUNCTION public.fn_budget_pode_executar(numeric) SET search_path = public;
ALTER FUNCTION public.fn_budget_registrar_gasto(numeric, text) SECURITY DEFINER;
ALTER FUNCTION public.fn_budget_registrar_gasto(numeric, text) SET search_path = public;
ALTER FUNCTION public.fn_budget_dashboard() SECURITY DEFINER;
ALTER FUNCTION public.fn_budget_dashboard() SET search_path = public;
REVOKE ALL ON FUNCTION public.fn_budget_pode_executar(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_budget_registrar_gasto(numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_budget_dashboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_budget_pode_executar(numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_budget_registrar_gasto(numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_budget_dashboard() TO service_role;
