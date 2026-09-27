-- 🚨 SEGURANÇA · PR 4 (28/09) — policies abertas (USING/WITH CHECK true para PUBLIC = anon + logado) em tabelas
-- que o anon alcança. Achadas pela auditoria ampliada (fn_seguranca_rls_auditar.policy_aberta_para_anon).
-- RLS ligada não protege nada quando a policy é "true": anon lia/gravava/apagava tudo nestas tabelas.
--
-- Tratamento (nada é apagado — só policies e GRANTs mudam):
--  · anon: REVOKE ALL em todas.
--  · lgpd_consentimentos: sai lgpd_all (qualquer um lia todos os consentimentos com e-mail e IP); ficam as policies
--    que já existiam — cada um grava/lê o PRÓPRIO; admin PS lê todos — agora só para authenticated.
--  · audit_log_global: sai audit_log_insert (qualquer um, até anon, forjava registro de auditoria). Quem grava são
--    funções/gatilhos SECURITY DEFINER do dono (nenhuma função INVOKER nem tela insere direto) — seguem gravando.
--  · business_line_custos / business_line_receitas → regra da tabela-mãe business_line_config (empresa do usuário);
--    business_line_keywords → business_lines; rateio_distribuicao → erp_lancamentos (quem vê o lançamento vê o rateio).
--  · company_groups: saem allow_all_cg / allow_all_groups / select true; o logado lê os grupos das SUAS empresas
--    (admin PS lê e gerencia todos — company_groups_manage fica).
--  · exchange_rates / taxas_cambio / plans / dominio_bi / wealth_consent_templates / erp_gov_nfse_municipios:
--    catálogo — só leitura para logado; escrita só admin PS (onde havia "qualquer um grava") e service_role.
--  · _archived_role_permissions_legacy_v0_2026_05_22: arquivo — sem policy (invisível ao app).
--  · fiscal_codigo_catalogo / fiscal_correlacao_servico / fiscal_reforma_parametro: policies de PUBLIC → authenticated.
--  · invites: NÃO entra aqui — a página pública /convite lê o convite como anon e o marca como usado; precisa de
--    RPC própria com verificação de quem aceita (PR separada), senão o cadastro por convite quebra.

-- (Sem LOCK TABLE: o `supabase db push` roda cada comando fora de bloco de transação — LOCK derrubou o deploy de
-- 28/09 com 25P01. Cada comando confirma sozinho e segura auth.users só por milissegundos; todo comando aqui é
-- idempotente — DROP ... IF EXISTS antes de cada CREATE — então um reenvio após falha parcial é seguro.)

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['_archived_role_permissions_legacy_v0_2026_05_22','audit_log_global','business_line_custos',
    'business_line_keywords','business_line_receitas','company_groups','dominio_bi','erp_gov_nfse_municipios','exchange_rates',
    'lgpd_consentimentos','plans','rateio_distribuicao','taxas_cambio','wealth_consent_templates'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- arquivo
DROP POLICY IF EXISTS "All users see permissions" ON public._archived_role_permissions_legacy_v0_2026_05_22;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public._archived_role_permissions_legacy_v0_2026_05_22 FROM authenticated;

-- auditoria: ninguém forja registro pela API
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log_global;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log_global FROM authenticated;

-- LGPD: cada um o seu
DROP POLICY IF EXISTS lgpd_all ON public.lgpd_consentimentos;
DROP POLICY IF EXISTS lgpd_insert ON public.lgpd_consentimentos;
DROP POLICY IF EXISTS lgpd_select ON public.lgpd_consentimentos;
CREATE POLICY lgpd_insert ON public.lgpd_consentimentos FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY lgpd_select ON public.lgpd_consentimentos FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.lgpd_consentimentos FROM authenticated;

-- linhas de negócio / rateio: regra da tabela-mãe
DROP POLICY IF EXISTS allow_all_blcustos ON public.business_line_custos;
DROP POLICY IF EXISTS business_line_custos_via_config ON public.business_line_custos;
CREATE POLICY business_line_custos_via_config ON public.business_line_custos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.business_line_config b WHERE b.id = business_line_custos.business_line_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.business_line_config b WHERE b.id = business_line_custos.business_line_id));

DROP POLICY IF EXISTS allow_all_blreceitas ON public.business_line_receitas;
DROP POLICY IF EXISTS business_line_receitas_via_config ON public.business_line_receitas;
CREATE POLICY business_line_receitas_via_config ON public.business_line_receitas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.business_line_config b WHERE b.id = business_line_receitas.business_line_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.business_line_config b WHERE b.id = business_line_receitas.business_line_id));

DROP POLICY IF EXISTS bl_keywords_all ON public.business_line_keywords;
DROP POLICY IF EXISTS business_line_keywords_via_linha ON public.business_line_keywords;
CREATE POLICY business_line_keywords_via_linha ON public.business_line_keywords FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.business_lines b WHERE b.id = business_line_keywords.business_line_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.business_lines b WHERE b.id = business_line_keywords.business_line_id));

DROP POLICY IF EXISTS rd_all ON public.rateio_distribuicao;
DROP POLICY IF EXISTS rateio_distribuicao_via_lancamento ON public.rateio_distribuicao;
CREATE POLICY rateio_distribuicao_via_lancamento ON public.rateio_distribuicao FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.erp_lancamentos l WHERE l.id = rateio_distribuicao.lancamento_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.erp_lancamentos l WHERE l.id = rateio_distribuicao.lancamento_id));

-- grupos: os das minhas empresas (admin PS: todos, via company_groups_manage)
DROP POLICY IF EXISTS allow_all_cg ON public.company_groups;
DROP POLICY IF EXISTS allow_all_groups ON public.company_groups;
DROP POLICY IF EXISTS company_groups_select ON public.company_groups;
CREATE POLICY company_groups_select ON public.company_groups FOR SELECT TO authenticated
  USING (public.is_admin() OR id IN (SELECT c.group_id FROM public.companies c WHERE c.id IN (SELECT public.get_user_company_ids())));

-- catálogos: leitura para logado; escrita admin PS
DROP POLICY IF EXISTS "Anyone can insert exchange_rates" ON public.exchange_rates;
DROP POLICY IF EXISTS "Anyone can update exchange_rates" ON public.exchange_rates;
DROP POLICY IF EXISTS "Anyone can read exchange_rates" ON public.exchange_rates;
DROP POLICY IF EXISTS exchange_rates_select ON public.exchange_rates;
DROP POLICY IF EXISTS exchange_rates_admin ON public.exchange_rates;
CREATE POLICY exchange_rates_select ON public.exchange_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY exchange_rates_admin ON public.exchange_rates FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS tc_all ON public.taxas_cambio;
DROP POLICY IF EXISTS taxas_cambio_select ON public.taxas_cambio;
DROP POLICY IF EXISTS taxas_cambio_admin ON public.taxas_cambio;
CREATE POLICY taxas_cambio_select ON public.taxas_cambio FOR SELECT TO authenticated USING (true);
CREATE POLICY taxas_cambio_admin ON public.taxas_cambio FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS plans_select ON public.plans;
CREATE POLICY plans_select ON public.plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS dominio_bi_read ON public.dominio_bi;
CREATE POLICY dominio_bi_read ON public.dominio_bi FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS consent_tpl_select_all ON public.wealth_consent_templates;
CREATE POLICY consent_tpl_select_all ON public.wealth_consent_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS municipios_sel ON public.erp_gov_nfse_municipios;
CREATE POLICY municipios_sel ON public.erp_gov_nfse_municipios FOR SELECT TO authenticated USING (true);

-- catálogos fiscais (NBS/cClassTrib, correlação de serviço, parâmetros da reforma): as policies eram para PUBLIC.
-- Hoje o anon não tem GRANT nessas tabelas (a auditoria não as acusava), mas a policy aberta fica a um GRANT de vazar
-- — o CEO contou 22 com elas. Passam a valer só para o logado; escrita segue só admin PS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fiscal_codigo_catalogo','fiscal_correlacao_servico','fiscal_reforma_parametro'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
  END LOOP;
END $$;
ALTER POLICY fiscal_cat_read ON public.fiscal_codigo_catalogo TO authenticated;
ALTER POLICY fiscal_cat_write ON public.fiscal_codigo_catalogo TO authenticated;
ALTER POLICY fcs_read ON public.fiscal_correlacao_servico TO authenticated;
ALTER POLICY fcs_write ON public.fiscal_correlacao_servico TO authenticated;
ALTER POLICY frp_read ON public.fiscal_reforma_parametro TO authenticated;
ALTER POLICY frp_write ON public.fiscal_reforma_parametro TO authenticated;

-- trava: nenhuma policy USING/WITH CHECK (true) para anon/PUBLIC fora de invites (PR 5, convite com RPC própria)
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v FROM pg_policies
   WHERE schemaname = 'public' AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
     AND (coalesce(qual, '') IN ('true', '(true)') OR coalesce(with_check, '') IN ('true', '(true)'))
     AND tablename <> 'invites';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'PR4: ainda ha policy aberta para anon/PUBLIC: %', v; END IF;
END $$;
