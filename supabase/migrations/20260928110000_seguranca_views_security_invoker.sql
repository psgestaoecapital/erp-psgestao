-- 🚨 SEGURANÇA (CEO 28/09, prioridade 3) · views com direitos do dono mostravam dado de TODAS as empresas a quem
-- está logado. 108 views do public rodavam como o dono (security_invoker desligado): a RLS das tabelas por baixo
-- não valia — um cliente logado lia, p.ex., 14.706 títulos de todas as empresas (v_titulos_consolidados) e 8.142
-- funcionários de compliance de outras empresas. Esta migration liga security_invoker em TODAS: cada view passa a
-- respeitar a RLS das tabelas para quem consulta. service_role e funções SECURITY DEFINER do dono não mudam.
--
-- Antes de ligar, alinha a LEITURA das tabelas cuja policy olhava só user_companies (vínculo direto) ao resto do
-- sistema — get_user_company_ids(): vínculo direto + PS_ADMIN/PS_ADMIN_CVM (o suporte PS). Sem isso, as views
-- de compliance, EPI, contratos, calendário, alertas e fiscal ficariam vazias para o suporte PS (provado).
-- Só se ACRESCENTA uma policy de SELECT (permissiva); as policies de escrita ficam como estão.
-- Fora de propósito: erp_certificados_a1 e erp_fiscal_provider_config (credenciais — só pelas funções/serviço)
-- e audit_log_global (restrição admin/dono é intencional).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_calendar_tarefas','compliance_consultas','compliance_dispensas','compliance_documentos',
                           'compliance_prestadores','epi_alerta','epi_estoque','epi_ficha','epi_movimentacao',
                           'erp_alerta_proativo','erp_contratos','erp_gov_nfse_dps','erp_nfe_emitidas','erp_nfse_emitidas']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_empresas_usuario', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()))',
                   t || '_select_empresas_usuario', t);
  END LOOP;
END $$;

-- funcionário: empregadora OU tomadora (mesma regra da policy existente, com o conjunto completo de empresas)
DROP POLICY IF EXISTS compliance_funcionarios_select_empresas_usuario ON public.compliance_funcionarios;
CREATE POLICY compliance_funcionarios_select_empresas_usuario ON public.compliance_funcionarios FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR empresa_tomadora_id IN (SELECT get_user_company_ids()));

-- catálogo de EPI: global continua visível a todos; o da empresa, a quem tem a empresa
DROP POLICY IF EXISTS epi_catalogo_select_empresas_usuario ON public.epi_catalogo;
CREATE POLICY epi_catalogo_select_empresas_usuario ON public.epi_catalogo FOR SELECT TO authenticated
  USING (is_global = true OR company_id IN (SELECT get_user_company_ids()));

-- todas as views do schema public passam a respeitar a RLS de quem consulta
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
              AND COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false')
                  NOT IN ('on', 'true')
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v.relname);
  END LOOP;
END $$;
