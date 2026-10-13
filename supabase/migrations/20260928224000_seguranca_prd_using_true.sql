-- 🚨 SEGURANÇA · PR D (CEO 28/09) — policies USING(true) para authenticated: todo logado lia a tabela INTEIRA.
--
-- (1) 9 furos reais (tabela COM company_id): qualquer cliente logado lia conciliação, alertas/log do Truth, sugestões
--     de de-para, módulos e assinaturas de TODAS as empresas. Troca o SELECT aberto por "empresa do usuário"
--     (get_user_company_ids — a mesma regra das 251 tabelas; PS_ADMIN segue vendo as não restritas e NÃO vê as
--     restritas) + equipe PS (is_admin / fn_pode_ver_fila_suporte) só nas linhas SEM empresa (company_id nulo).
--     O convite (invites UPDATE) já foi fechado na #1887.
-- (2) 6 internas (sem company_id, só a equipe PS usa): organizations, erp_sessao_chat, erp_artefato_sessao,
--     dev_vertical, erp_roadmap_marcos, truth_audit_rules → SELECT só para a equipe PS.
-- (3) Os catálogos que SEGUEM abertos ao logado ganham COMMENT ON POLICY 'catalogo: <família> — <motivo>' (a
--     documentação fica no próprio banco, ao lado da policy). A guarda final exige: nenhuma policy USING(true)
--     para authenticated em tabela com company_id, e toda USING(true) restante documentada como catálogo.
-- Nenhum dado é alterado; só quem pode LER. Escrita já era por empresa (policies *_tenant) ou só service_role.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('conciliacao_lote',      'auth read'),
    ('conciliacao_movimento', 'auth read'),
    ('conciliacao_regra',     'auth read'),
    ('conciliacao_vinculo',   'conc_vinculo_read'),
    ('erp_truth_alerts',      'auth_can_read_truth_alerts'),
    ('erp_truth_audit_log',   'auth_can_read_truth_log'),
    ('psgc_depara_sugestoes', 'auth_can_read_sugestoes'),
    ('tenant_modules_active', 'auth_can_read_modules_active'),
    ('tenant_subscriptions',  'auth_can_read_subscriptions')
  ) v(tabela, policy)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policy, r.tabela);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tabela || '_sel_empresa', r.tabela);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids())
             OR (company_id IS NULL AND (public.is_admin() OR public.fn_pode_ver_fila_suporte())))$p$,
      r.tabela || '_sel_empresa', r.tabela);
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('organizations',        'org_select_authenticated'),
    ('erp_sessao_chat',      'auth read'),
    ('erp_artefato_sessao',  'auth read'),
    ('dev_vertical',         'dev_vertical_sel'),
    ('erp_roadmap_marcos',   'auth_can_read_roadmap'),
    ('truth_audit_rules',    'auth_can_read_truth_rules')
  ) v(tabela, policy)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policy, r.tabela);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tabela || '_sel_equipe_ps', r.tabela);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (public.is_admin() OR public.fn_pode_ver_fila_suporte())$p$,
      r.tabela || '_sel_equipe_ps', r.tabela);
  END LOOP;
END $$;

-- (3) Catálogos que seguem abertos ao logado — motivo por família.
DO $$
DECLARE r record; v_motivo text;
BEGIN
  FOR r IN SELECT p.tablename, p.policyname FROM pg_policies p
           WHERE p.schemaname = 'public' AND 'authenticated' = ANY(p.roles) AND p.cmd = 'SELECT'
             AND coalesce(p.qual,'') IN ('true','(true)')
  LOOP
    v_motivo := CASE
      WHEN r.tablename IN ('access_config','area_menu_config','dashboard_atalhos_default','module_catalog','module_subgrupos',
                           'plan_catalog','plan_modules','plans','rbac_papel','rbac_papel_acesso','rbac_subgrupo_catalogo',
                           'role_permissions','screen_route_features','feature_catalog','ia_feature_catalogo','data_sources')
        THEN 'catalogo: menu/planos/permissões — o app monta menu, rotas e papéis de qualquer logado a partir dele; sem dado de empresa'
      WHEN r.tablename IN ('fiscal_codigo_catalogo','fiscal_correlacao_servico','fiscal_ibpt_aliquota','fiscal_lc116_exige_obra',
                           'fiscal_ncm_regras','fiscal_reforma_parametro','erp_fiscal_erro_catalogo','erp_gov_nfse_municipios',
                           'legislacao_vigente')
        THEN 'catalogo: fiscal/legislação — tabelas públicas (LC 116, NCM, IBPT, municípios, reforma) usadas na emissão de qualquer empresa'
      WHEN r.tablename IN ('erp_banco_erro_catalogo','erp_banco_manifesto','erp_remessa_ocorrencia_mapa')
        THEN 'catalogo: bancário — códigos FEBRABAN/CNAB e manifesto dos bancos, iguais para todas as empresas'
      WHEN r.tablename IN ('compliance_tipos_documento','epi_categoria')
        THEN 'catalogo: SST/compliance — tipos de documento e categorias de EPI das NRs, iguais para todas as empresas'
      WHEN r.tablename IN ('lgpd_bases_legais','lgpd_finalidades_tratamento','lgpd_versao_vigente')
        THEN 'catalogo: LGPD — bases legais, finalidades e versão vigente do termo; a tela de aceite de qualquer logado lê'
      WHEN r.tablename IN ('agro_bi_tema','ind_bi_tema','dominio_bi','ind_especie_perfil','import_preset_mapeamento')
        THEN 'catalogo: BI/importação — temas visuais, perfis de espécie e presets de mapeamento, sem dado de empresa'
      WHEN r.tablename IN ('exchange_rates','taxas_cambio','wealth_assets','wealth_price_history','wealth_ips_templates',
                           'wealth_consent_templates')
        THEN 'catalogo: mercado/wealth — cotações, ativos e modelos públicos; a carteira do cliente fica em tabelas por empresa'
    END;
    IF v_motivo IS NULL THEN
      RAISE EXCEPTION 'PR D: policy USING(true) sem família de catálogo: %.% — classifique antes de seguir', r.tablename, r.policyname;
    END IF;
    EXECUTE format('COMMENT ON POLICY %I ON public.%I IS %L', r.policyname, r.tablename, v_motivo);
  END LOOP;

  -- Guarda final
  IF EXISTS (SELECT 1 FROM pg_policies p
             WHERE p.schemaname = 'public' AND 'authenticated' = ANY(p.roles)
               AND (coalesce(p.qual,'') IN ('true','(true)') OR coalesce(p.with_check,'') IN ('true','(true)'))
               AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
                             AND c.table_name = p.tablename AND c.column_name = 'company_id')) THEN
    RAISE EXCEPTION 'PR D: ainda há policy USING(true) para authenticated em tabela com company_id';
  END IF;
END $$;
