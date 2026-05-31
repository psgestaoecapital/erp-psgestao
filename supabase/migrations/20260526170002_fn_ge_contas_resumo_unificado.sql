-- PR-FIX-SALDO-UNIFICADO · fn_ge_contas_resumo segunda versão (CEO 26/05/2026)
-- Aplicado via MCP apply_migration · rastreio histórico.
-- Validado: PS LTDA Sicoob R$ 233.711,05 (era R$ 25.084,93)
--           PS Consultoria Nubank R$ 113.394,70 (era R$ 2.954,27)
--
-- Distribuição por conta:
-- - 1 conta única (caso PS LTDA + PS Consultoria): toda movimentação
--   vai pra ela (saldo_atual = saldo_total).
-- - N contas: proporcional ao saldo_inicial de cada uma (fallback igual
--   se todos saldos_iniciais = 0).
-- - Decisão arquitetural: nenhum lançamento atual tem conta_bancaria
--   preenchido · qualquer atribuição estrita seria fictícia · proporção
--   é o mais honesto sem dados reais de vinculação.

CREATE OR REPLACE FUNCTION public.fn_ge_contas_resumo(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_saldo_total numeric;
  v_qtd_contas int;
  v_soma_iniciais numeric;
  v_contas jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  v_saldo_total := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);

  SELECT COUNT(*), COALESCE(SUM(COALESCE(saldo_inicial, 0)), 0)
    INTO v_qtd_contas, v_soma_iniciais
  FROM erp_banco_contas
  WHERE company_id = p_company_id
    AND ativo = true
    AND COALESCE(soma_no_saldo, true) = true;

  SELECT COALESCE(jsonb_agg(c ORDER BY (c->>'saldo_atual')::numeric DESC), '[]'::jsonb) INTO v_contas
  FROM (
    SELECT jsonb_build_object(
      'id', bc.id,
      'nome', bc.nome,
      'tipo_conta', bc.tipo_conta,
      'saldo_atual',
        CASE
          WHEN v_qtd_contas = 1 THEN v_saldo_total
          WHEN v_soma_iniciais > 0 THEN
            ROUND(v_saldo_total * (COALESCE(bc.saldo_inicial, 0) / v_soma_iniciais), 2)
          ELSE ROUND(v_saldo_total / v_qtd_contas, 2)
        END,
      'ultima_importacao', bc.updated_at,
      'conciliacoes_pendentes', COALESCE((
        SELECT COUNT(*) FROM conciliacao_lote cl
        WHERE cl.conta_bancaria_id = bc.id AND cl.status = 'pendente'
      ), 0)
    ) AS c
    FROM erp_banco_contas bc
    WHERE bc.company_id = p_company_id
      AND bc.ativo = true
      AND COALESCE(bc.soma_no_saldo, true) = true
  ) sub;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_total', v_saldo_total,
    'qtd_contas', v_qtd_contas,
    'contas', v_contas
  );
END;
$$;
