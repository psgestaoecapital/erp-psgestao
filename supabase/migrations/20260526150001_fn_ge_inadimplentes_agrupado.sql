-- PR 16 batch CEO 26/05/2026 (cristalização d4c92cd8)
-- Aplicado via MCP apply_migration · rastreio histórico.
-- Validado PS LTDA: 7 clientes inadimplentes · R$ 11.500 · TOY TINTAS topo (16 dias atraso).

CREATE OR REPLACE FUNCTION public.fn_ge_inadimplentes_agrupado(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_resumo jsonb;
  v_clientes jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  WITH base AS (
    SELECT
      er.cliente_id, er.cliente_nome,
      er.id, er.descricao, er.valor, er.data_vencimento,
      (CURRENT_DATE - er.data_vencimento)::int AS dias_atraso
    FROM erp_receber er
    WHERE er.company_id = p_company_id
      AND er.status = 'aberto'
      AND er.data_vencimento < CURRENT_DATE
  )
  SELECT jsonb_build_object(
    'qtd_clientes', COALESCE((SELECT COUNT(DISTINCT COALESCE(cliente_id::text, cliente_nome, '')) FROM base), 0),
    'total_qtd_contas', COALESCE((SELECT COUNT(*) FROM base), 0),
    'total_valor', COALESCE((SELECT SUM(valor) FROM base), 0),
    'dias_max_atraso', COALESCE((SELECT MAX(dias_atraso) FROM base), 0)
  ) INTO v_resumo;

  WITH base AS (
    SELECT
      er.cliente_id, er.cliente_nome,
      er.id AS conta_id, er.descricao, er.valor, er.data_vencimento,
      (CURRENT_DATE - er.data_vencimento)::int AS dias_atraso
    FROM erp_receber er
    WHERE er.company_id = p_company_id
      AND er.status = 'aberto'
      AND er.data_vencimento < CURRENT_DATE
  ),
  por_cliente AS (
    SELECT
      cliente_id, cliente_nome,
      COUNT(*) AS qtd_contas,
      SUM(valor) AS valor_total,
      MAX(dias_atraso) AS dias_max_atraso,
      ROUND(AVG(dias_atraso))::int AS dias_medio_atraso,
      jsonb_agg(jsonb_build_object(
        'id', conta_id,
        'descricao', descricao,
        'valor', valor,
        'vencimento', data_vencimento,
        'dias_atraso', dias_atraso
      ) ORDER BY data_vencimento) AS contas
    FROM base
    GROUP BY cliente_id, cliente_nome
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cliente_id', pc.cliente_id,
    'cliente_nome', pc.cliente_nome,
    'cnpj', COALESCE(c.cnpj_cpf, c.cpf_cnpj),
    'telefone', COALESCE(c.celular, c.telefone),
    'whatsapp', c.whatsapp,
    'email', c.email,
    'qtd_contas', pc.qtd_contas,
    'valor_total', pc.valor_total,
    'dias_max_atraso', pc.dias_max_atraso,
    'dias_medio_atraso', pc.dias_medio_atraso,
    'contas', pc.contas
  ) ORDER BY pc.dias_max_atraso DESC, pc.valor_total DESC), '[]'::jsonb) INTO v_clientes
  FROM por_cliente pc
  LEFT JOIN erp_clientes c ON c.id = pc.cliente_id;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'resumo', v_resumo,
    'clientes', v_clientes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ge_inadimplentes_agrupado(uuid) TO authenticated;
