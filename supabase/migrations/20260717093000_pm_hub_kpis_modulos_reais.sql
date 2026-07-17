-- Rótulo não mente: leads/briefings/margem estão REAIS no ar (lotes Comercial+Produção). O "Módulos
-- próximos" do Hub P&M deixa de listá-los como 'previsto' e mostra só os genuinamente pendentes
-- (Financeiro). Também tolera os status novos de job (concluida/publicado) nos contadores.
CREATE OR REPLACE FUNCTION public.fn_pm_hub_kpis(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'clientes_ativos', 0, 'jobs_em_andamento', 0, 'jobs_concluidos_mes', 0, 'horas_mes', 0,
      'receita_fee_mensal', 0, 'briefings_pendentes', 0, 'propostas_em_aberto', 0,
      'tem_workspace_pronto', false, 'empty_state', true,
      'mensagem_empty', 'Selecione uma empresa para ver os KPIs da agência'
    );
  END IF;

  SELECT jsonb_build_object(
    'clientes_ativos', (SELECT COUNT(*) FROM agency_clientes WHERE company_id=p_company_id AND COALESCE(status,'ativo')='ativo'),
    'jobs_em_andamento', (SELECT COUNT(*) FROM agency_jobs WHERE company_id=p_company_id AND COALESCE(status,'briefing') NOT IN ('concluido','concluida','cancelado','arquivado','publicado')),
    'jobs_concluidos_mes', (SELECT COUNT(*) FROM agency_jobs WHERE company_id=p_company_id AND status IN ('concluido','concluida','publicado') AND date_trunc('month', updated_at) = date_trunc('month', CURRENT_DATE)),
    'horas_mes', (SELECT COALESCE(SUM(horas),0)::numeric(10,2) FROM agency_timesheet WHERE company_id=p_company_id AND date_trunc('month', data) = date_trunc('month', CURRENT_DATE)),
    'receita_fee_mensal', (SELECT COALESCE(SUM(fee_mensal),0)::numeric(10,2) FROM agency_clientes WHERE company_id=p_company_id AND COALESCE(status,'ativo')='ativo'),
    'briefings_pendentes', (SELECT COUNT(*) FROM agency_briefings WHERE company_id=p_company_id AND COALESCE(status,'novo') IN ('novo','pendente','em_analise')),
    'propostas_em_aberto', (SELECT COUNT(*) FROM agency_propostas WHERE company_id=p_company_id AND COALESCE(status,'rascunho') IN ('rascunho','enviada','em_negociacao')),
    'tem_workspace_pronto', true,
    'workspace_url', '/dashboard/producao?area=pm',
    'empty_state', false,
    'modulos_proximos', jsonb_build_array(
      jsonb_build_object('id','pm_contratos','nome','Contratos','rota','/dashboard/pm/contratos','status','previsto'),
      jsonb_build_object('id','pm_comissao','nome','Comissão','rota','/dashboard/pm/comissao','status','previsto'),
      jsonb_build_object('id','pm_cobranca','nome','Cobrança por etapa','rota','/dashboard/pm/cobranca','status','previsto')
    )
  ) INTO v_result;

  RETURN v_result;
END $function$;
