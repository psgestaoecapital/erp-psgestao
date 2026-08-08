-- SPEC IA-1.2 · Odonto — Consultor IA da Clínica: agregador de contexto read-only (KPIs da clínica pra
-- a IA responder com números reais). RD-56/RD-41/RD-51. SECURITY DEFINER + guard de empresa (Pilar 2).
-- Bounded: só contagens/somas + listas top-5 (cabe no prompt). Sem PII além do necessário (nomes p/ ação).

CREATE OR REPLACE FUNCTION public.fn_odonto_clinica_contexto_ia(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ins jsonb; v_risco jsonb; v_risco_n int; v_devedores jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;

  BEGIN v_ins := fn_consultor_insights(p_company_id, extract(year from now())::int, extract(month from now())::int);
  EXCEPTION WHEN OTHERS THEN v_ins := NULL; END;

  -- pacientes em risco de evasão: ativos, com plano não concluído, sem consulta há >60 dias (ou nunca)
  SELECT count(*) INTO v_risco_n FROM (
    SELECT p.id FROM erp_odonto_paciente p
    LEFT JOIN erp_odonto_agendamento a ON a.paciente_id = p.id AND a.data <= current_date
    WHERE p.company_id = p_company_id AND p.ativo
      AND EXISTS (SELECT 1 FROM erp_odonto_plano_tratamento t WHERE t.paciente_id = p.id AND t.status IN ('aprovado','em_andamento','orcamento'))
    GROUP BY p.id HAVING max(a.data) IS NULL OR max(a.data) < current_date - 60) r;
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'dias_sem_consulta', dias)), '[]'::jsonb) INTO v_risco FROM (
    SELECT p.nome, (current_date - max(a.data))::int AS dias FROM erp_odonto_paciente p
    LEFT JOIN erp_odonto_agendamento a ON a.paciente_id = p.id AND a.data <= current_date
    WHERE p.company_id = p_company_id AND p.ativo
      AND EXISTS (SELECT 1 FROM erp_odonto_plano_tratamento t WHERE t.paciente_id = p.id AND t.status IN ('aprovado','em_andamento','orcamento'))
    GROUP BY p.id, p.nome HAVING max(a.data) IS NULL OR max(a.data) < current_date - 60
    ORDER BY dias DESC NULLS FIRST LIMIT 5) x;

  -- top devedores (odonto)
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'aberto', aberto)), '[]'::jsonb) INTO v_devedores FROM (
    SELECT coalesce(r.cliente_nome, 'Cliente') AS nome, sum(r.valor) AS aberto
    FROM erp_receber r WHERE r.company_id = p_company_id AND (r.ref_externa_sistema = 'odonto_plano' OR r.categoria = 'Odontologia')
      AND r.status IN ('aberto','vencido')
    GROUP BY r.cliente_nome ORDER BY sum(r.valor) DESC LIMIT 5) d;

  RETURN jsonb_build_object(
    'ok', true, 'gerado_em', now(),
    'pacientes', (SELECT jsonb_build_object(
        'ativos', count(*) FILTER (WHERE ativo),
        'novos_mes', count(*) FILTER (WHERE created_at >= date_trunc('month', now())))
      FROM erp_odonto_paciente WHERE company_id = p_company_id),
    'em_risco_evasao', jsonb_build_object('quantidade', coalesce(v_risco_n,0), 'exemplos', v_risco),
    'agenda', (SELECT jsonb_build_object(
        'proximos_7d', count(*) FILTER (WHERE data BETWEEN current_date AND current_date + 7 AND status NOT IN ('cancelado','faltou')),
        'no_show_mes', count(*) FILTER (WHERE status = 'faltou' AND data >= date_trunc('month', now())),
        'concluidas_mes', count(*) FILTER (WHERE status = 'concluido' AND data >= date_trunc('month', now())))
      FROM erp_odonto_agendamento WHERE company_id = p_company_id),
    'comercial', jsonb_build_object(
        'aprovados_sem_agendar', (SELECT count(*) FROM erp_odonto_plano_tratamento t WHERE t.company_id = p_company_id AND t.status = 'aprovado'
            AND NOT EXISTS (SELECT 1 FROM erp_odonto_agendamento a WHERE a.paciente_id = t.paciente_id AND a.data >= current_date AND a.status NOT IN ('cancelado','faltou'))),
        'orcamentos_abertos', (SELECT jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor_total),0)) FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id AND status IN ('rascunho','orcamento')),
        'planos_aprovados', (SELECT count(*) FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id AND status IN ('aprovado','em_andamento','concluido')),
        'planos_total', (SELECT count(*) FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id)),
    'financeiro', (SELECT jsonb_build_object(
        'a_receber', coalesce(sum(valor) FILTER (WHERE status IN ('aberto','vencido')),0),
        'inadimplencia', coalesce(sum(valor) FILTER (WHERE status IN ('aberto','vencido') AND data_vencimento < current_date),0),
        'recebido_mes', coalesce(sum(valor) FILTER (WHERE status IN ('pago','recebido') AND coalesce(data_pagamento, data_vencimento) >= date_trunc('month', now())),0),
        'top_devedores', v_devedores)
      FROM erp_receber WHERE company_id = p_company_id AND (ref_externa_sistema = 'odonto_plano' OR categoria = 'Odontologia')),
    'clinico_planos_por_status', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM erp_odonto_plano_tratamento WHERE company_id = p_company_id GROUP BY status) s), '{}'::jsonb),
    'insights_regras', v_ins
  );
END $$;
REVOKE ALL ON FUNCTION public.fn_odonto_clinica_contexto_ia(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_odonto_clinica_contexto_ia(uuid) TO authenticated;
