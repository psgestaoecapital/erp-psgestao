-- 🚨 Segurança (CEO 05/10 · achado do Eng. Chefe): views em public lidas por authenticated sem security_invoker rodam
-- como o dono e ignoram a RLS das tabelas — um usuário logado de uma empresa lia dados de outras via API.
-- Onda 1 = dados sensíveis de cliente (financeiro/títulos/DRE, compliance/EPI/folha, odonto, veículos).
-- Provado no catálogo (05/10): todas as tabelas-base têm RLS ligada e policy de SELECT por empresa para authenticated
-- (as únicas "true" são catálogos globais: compliance_tipos_documento, epi_categoria). Com security_invoker=true a view
-- passa a respeitar a RLS de quem consulta; service_role segue vendo tudo. Aditivo e reversível (RESET).
ALTER VIEW public.v_compliance_calendar_dashboard   SET (security_invoker = true);
ALTER VIEW public.v_compliance_matriz_prestadores   SET (security_invoker = true);
ALTER VIEW public.v_compliance_status_consultas     SET (security_invoker = true);
ALTER VIEW public.v_contas_pagar_aging              SET (security_invoker = true);
ALTER VIEW public.v_contas_receber_aging            SET (security_invoker = true);
ALTER VIEW public.v_custo_folha_setor               SET (security_invoker = true);
ALTER VIEW public.v_psgc_dre_divisional             SET (security_invoker = true);
ALTER VIEW public.v_dre_divisional_completo         SET (security_invoker = true);
ALTER VIEW public.v_dre_receita_3_fontes            SET (security_invoker = true);
ALTER VIEW public.v_epi_dashboard                   SET (security_invoker = true);
ALTER VIEW public.v_epi_ficha_funcionario           SET (security_invoker = true);
ALTER VIEW public.v_epi_funcionarios_consolidado    SET (security_invoker = true);
ALTER VIEW public.v_lancamentos_consolidado         SET (security_invoker = true);
ALTER VIEW public.v_odonto_debitos_paciente         SET (security_invoker = true);
ALTER VIEW public.v_psgc_dre_nivel2                 SET (security_invoker = true);
ALTER VIEW public.v_psgc_dre_nivel3                 SET (security_invoker = true);
ALTER VIEW public.v_psgc_fluxo_projecao             SET (security_invoker = true);
ALTER VIEW public.v_psgc_pagar_distribuido          SET (security_invoker = true);
ALTER VIEW public.v_receber_efetivo                 SET (security_invoker = true);
ALTER VIEW public.v_titulos_consolidados            SET (security_invoker = true);
ALTER VIEW public.v_veic_patio                      SET (security_invoker = true);
ALTER VIEW public.v_veic_venda                      SET (security_invoker = true);

-- Auditoria (RD-79): views de public legíveis por authenticated sem security_invoker. Só conexão de serviço.
CREATE OR REPLACE FUNCTION public.fn_seguranca_views_sem_invoker()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $f$
  SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), ARRAY[]::text[])
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND has_table_privilege('authenticated', c.oid, 'SELECT')
    AND NOT COALESCE('security_invoker=true' = ANY(c.reloptions), false)
$f$;
REVOKE ALL ON FUNCTION public.fn_seguranca_views_sem_invoker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seguranca_views_sem_invoker() TO service_role;
