-- SPEC · Painel de Planos & Orçamentos (funil comercial da clínica). RD-56/RD-41/RD-26.
-- Read-only: KPIs + lista de TODOS os planos/orçamentos da empresa (todos os pacientes). A criação/edição
-- do plano continua na Ficha (OD-2, fonte única) — este painel é a camada de GESTÃO por cima. RLS por company_id.

CREATE OR REPLACE FUNCTION public.fn_odonto_planos_clinica(
  p_company_id uuid, p_status text DEFAULT NULL, p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_aberto numeric; v_apr_mes_qtd int; v_apr_mes_val numeric; v_apr_total int; v_orc_total int;
  v_sem_agendar int; v_ticket numeric; v_lista jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  -- KPIs (clínica inteira, independente dos filtros da lista)
  SELECT coalesce(sum(valor_total) FILTER (WHERE status IN ('rascunho','orcamento')), 0) INTO v_aberto
    FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id;
  SELECT count(*) FILTER (WHERE aprovado_em >= date_trunc('month', now())),
         coalesce(sum(valor_total) FILTER (WHERE aprovado_em >= date_trunc('month', now())), 0)
    INTO v_apr_mes_qtd, v_apr_mes_val
    FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id AND status IN ('aprovado','em_andamento','concluido');
  SELECT count(*) FILTER (WHERE status IN ('aprovado','em_andamento','concluido')),
         count(*) FILTER (WHERE status IN ('rascunho','orcamento'))
    INTO v_apr_total, v_orc_total FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id;
  SELECT count(*) INTO v_sem_agendar FROM erp_odonto_plano_tratamento t
    WHERE t.company_id = p_company_id AND t.status = 'aprovado'
      AND NOT EXISTS (SELECT 1 FROM erp_odonto_agendamento a WHERE a.paciente_id = t.paciente_id AND a.data >= current_date AND a.status NOT IN ('cancelado','faltou'));
  SELECT coalesce(avg(valor_total) FILTER (WHERE status IN ('aprovado','em_andamento','concluido') AND valor_total > 0), 0) INTO v_ticket
    FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id;

  -- lista (filtrável por status/período), com paciente, % executado, profissional, agendamento, envio.
  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_lista FROM (
    SELECT t.id, coalesce(p.nome, 'Paciente') AS paciente_nome, t.paciente_id,
      coalesce(t.titulo, 'Plano') AS titulo, coalesce(t.valor_total, 0) AS valor_total, t.status,
      t.created_at, t.aprovado_em, coalesce(pf.nome, '') AS profissional_nome,
      (SELECT count(*) FROM erp_odonto_plano_item i WHERE i.plano_id = t.id) AS itens_total,
      (SELECT count(*) FROM erp_odonto_plano_item i WHERE i.plano_id = t.id AND i.concluido_em IS NOT NULL) AS itens_feitos,
      EXISTS (SELECT 1 FROM erp_odonto_agendamento a WHERE a.paciente_id = t.paciente_id AND a.data >= current_date AND a.status NOT IN ('cancelado','faltou')) AS tem_agendamento,
      (SELECT l.status FROM erp_odonto_proposta_link l WHERE l.plano_id = t.id ORDER BY l.created_at DESC LIMIT 1) AS envio_status
    FROM erp_odonto_plano_tratamento t
    LEFT JOIN erp_odonto_paciente p ON p.id = t.paciente_id
    LEFT JOIN erp_odonto_profissional pf ON pf.id = t.profissional_id
    WHERE t.company_id = p_company_id
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_de IS NULL OR t.created_at >= p_de)
      AND (p_ate IS NULL OR t.created_at < (p_ate + 1))
    ORDER BY t.created_at DESC LIMIT 300
  ) x;

  RETURN jsonb_build_object('ok', true,
    'kpis', jsonb_build_object(
      'em_aberto', v_aberto, 'aprovados_mes_qtd', v_apr_mes_qtd, 'aprovados_mes_valor', v_apr_mes_val,
      'taxa_aprovacao', CASE WHEN (v_apr_total + v_orc_total) > 0 THEN round(v_apr_total::numeric / (v_apr_total + v_orc_total) * 100, 1) ELSE 0 END,
      'aprovados_sem_agendar', v_sem_agendar, 'ticket_medio', round(v_ticket, 2)),
    'planos', v_lista);
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_planos_clinica(uuid,text,date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_planos_clinica(uuid,text,date,date) TO authenticated;
