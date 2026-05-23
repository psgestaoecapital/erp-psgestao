-- PR 2 · Função 3/6: contas bancárias da empresa + pendências de conciliação.
-- IPO #35: erp_banco_contas usa coluna `nome` (display), não `nome_banco`.

CREATE OR REPLACE FUNCTION public.fn_ge_contas_resumo(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_saldo_total numeric;
  v_contas jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_saldo_total
  FROM erp_banco_contas
  WHERE company_id = p_company_id;

  SELECT COALESCE(jsonb_agg(c ORDER BY (c->>'saldo_atual')::numeric DESC), '[]'::jsonb) INTO v_contas
  FROM (
    SELECT jsonb_build_object(
      'id', bc.id,
      'nome', bc.nome,
      'tipo_conta', bc.tipo_conta,
      'saldo_atual', COALESCE(bc.saldo_atual, 0),
      'ultima_importacao', bc.updated_at,
      'conciliacoes_pendentes', COALESCE((
        SELECT COUNT(*)
        FROM conciliacao_lote cl
        WHERE cl.conta_bancaria_id = bc.id
          AND cl.status = 'pendente'
      ), 0)
    ) AS c
    FROM erp_banco_contas bc
    WHERE bc.company_id = p_company_id
  ) sub;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_total', v_saldo_total,
    'qtd_contas', jsonb_array_length(v_contas),
    'contas', v_contas
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ge_contas_resumo(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_ge_contas_resumo(uuid) IS
'Lista contas bancárias com pendências de conciliação. Universal RD-38. PR 2 23/05/2026.';
