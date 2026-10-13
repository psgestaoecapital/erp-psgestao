-- PM Workspace: 5 estagios novos do Kanban + RPCs + ganchos financeiros (preview).
-- (Aplicada via MCP em 2026-06-26 — versionada no repo)
--
-- Estagios oficiais: nao_iniciada -> em_producao -> em_aprovacao -> concluida -> publicado.

-- Ganchos pra Frente 3 (preview, sem mexer em erp_pagar/erp_contratos)
ALTER TABLE agency_clientes ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES erp_contratos(id);
ALTER TABLE agency_jobs     ADD COLUMN IF NOT EXISTS percentual_comissao numeric(5,2);

CREATE INDEX IF NOT EXISTS idx_agency_clientes_contrato ON agency_clientes(contrato_id);

-- RPC: mover estagio do job (drag-and-drop)
CREATE OR REPLACE FUNCTION fn_pm_job_mover_status(p_job_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_comp uuid;
BEGIN
  IF p_status NOT IN ('nao_iniciada','em_producao','em_aprovacao','concluida','publicado') THEN
    RETURN jsonb_build_object('ok',false,'erro','status invalido');
  END IF;
  SELECT company_id INTO v_comp FROM agency_jobs WHERE id = p_job_id;
  IF v_comp IS NULL OR v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao');
  END IF;
  UPDATE agency_jobs SET status = p_status, updated_at = now() WHERE id = p_job_id;
  RETURN jsonb_build_object('ok',true,'status',p_status);
END;
$$;

-- RPC: kanban (jobs agrupados por estagio + resumo)
CREATE OR REPLACE FUNCTION fn_pm_kanban(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'estagios', (
      SELECT jsonb_agg(e) FROM (
        SELECT j.status AS estagio,
               count(*) AS qtd,
               COALESCE(sum(j.valor_job),0) AS valor_total,
               jsonb_agg(jsonb_build_object(
                 'id', j.id, 'titulo', j.titulo,
                 'cliente', COALESCE(c.nome_fantasia, c.nome),
                 'cliente_id', j.cliente_id,
                 'valor_job', j.valor_job,
                 'responsavel_id', j.responsavel_id,
                 'data_prazo', j.data_prazo,
                 'horas_estimadas', j.horas_estimadas,
                 'horas_realizadas', j.horas_realizadas,
                 'percentual_comissao', j.percentual_comissao,
                 'prioridade', j.prioridade
               ) ORDER BY j.data_prazo NULLS LAST, j.created_at) AS cards
        FROM agency_jobs j
        LEFT JOIN agency_clientes c ON c.id = j.cliente_id
        WHERE j.company_id = p_company_id
        GROUP BY j.status
      ) e
    ),
    'resumo', (
      SELECT jsonb_build_object(
        'total_jobs', count(*),
        'abertos', count(*) FILTER (WHERE status NOT IN ('publicado','concluida')),
        'valor_pipeline', COALESCE(sum(valor_job) FILTER (WHERE status NOT IN ('publicado')),0)
      ) FROM agency_jobs WHERE company_id = p_company_id
    )
  );
$$;

GRANT EXECUTE ON FUNCTION fn_pm_job_mover_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pm_kanban(uuid) TO authenticated;
