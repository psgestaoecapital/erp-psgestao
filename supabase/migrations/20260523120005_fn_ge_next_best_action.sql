-- PR 2 · Função 6/6: Consultor IA · próxima ação determinística.
-- Prioridade: cobrança (atrasados >30d) → pagamento crítico (<3d) → conciliação (>10) → estável.
-- IPO #35: cast text→date em data_vencimento.

CREATE OR REPLACE FUNCTION public.fn_ge_next_best_action(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pior_atrasado record;
  v_proxima_pagar record;
  v_qtd_conciliacoes_pendentes int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id
      AND plan_id = 'v15_gestao_empresarial_pro'
      AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  SELECT
    nome_pessoa,
    SUM(valor_documento) AS valor,
    MAX(CURRENT_DATE - NULLIF(data_vencimento,'')::date) AS dias
  INTO v_pior_atrasado
  FROM erp_lancamentos
  WHERE company_id = p_company_id
    AND tipo = 'receber'
    AND status != 'pago'
    AND NULLIF(data_vencimento,'')::date < CURRENT_DATE - INTERVAL '30 days'
  GROUP BY nome_pessoa
  ORDER BY MAX(CURRENT_DATE - NULLIF(data_vencimento,'')::date) DESC, SUM(valor_documento) DESC
  LIMIT 1;

  IF FOUND AND v_pior_atrasado.dias > 30 THEN
    RETURN jsonb_build_object(
      'company_id', p_company_id,
      'tipo', 'cobranca',
      'titulo', 'Sua melhor acao agora',
      'texto', 'Ligue para ' || v_pior_atrasado.nome_pessoa || ' hoje. Atrasado ha ' || v_pior_atrasado.dias || ' dias com R$ ' || TO_CHAR(v_pior_atrasado.valor, 'FM999G999G990D00') || '. Maior risco da carteira.',
      'cta_principal', 'Abrir Consultor IA',
      'cta_secundario', 'Marcar no calendario',
      'rota_principal', '/dashboard/consultor-ia?contexto=cobranca&cliente=' || v_pior_atrasado.nome_pessoa,
      'rota_secundaria', '/dashboard/calendario/nova-tarefa'
    );
  END IF;

  SELECT
    nome_pessoa,
    valor_documento AS valor,
    (NULLIF(data_vencimento,'')::date - CURRENT_DATE) AS dias_pra_vencer
  INTO v_proxima_pagar
  FROM erp_lancamentos
  WHERE company_id = p_company_id
    AND tipo = 'pagar'
    AND status != 'pago'
    AND NULLIF(data_vencimento,'')::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
  ORDER BY valor_documento DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'company_id', p_company_id,
      'tipo', 'pagamento',
      'titulo', 'Sua melhor acao agora',
      'texto', 'Pagamento critico em ' || v_proxima_pagar.dias_pra_vencer || ' dias: ' || v_proxima_pagar.nome_pessoa || ' R$ ' || TO_CHAR(v_proxima_pagar.valor, 'FM999G999G990D00') || '. Garante caixa pra honrar.',
      'cta_principal', 'Ver detalhes da conta',
      'cta_secundario', 'Marcar lembrete',
      'rota_principal', '/dashboard/contas-pagar',
      'rota_secundaria', '/dashboard/calendario/nova-tarefa'
    );
  END IF;

  SELECT COUNT(*) INTO v_qtd_conciliacoes_pendentes
  FROM conciliacao_lote cl
  JOIN erp_banco_contas bc ON bc.id = cl.conta_bancaria_id
  WHERE bc.company_id = p_company_id AND cl.status = 'pendente';

  IF v_qtd_conciliacoes_pendentes > 10 THEN
    RETURN jsonb_build_object(
      'company_id', p_company_id,
      'tipo', 'conciliacao',
      'titulo', 'Sua melhor acao agora',
      'texto', 'Voce tem ' || v_qtd_conciliacoes_pendentes || ' conciliacoes bancarias pendentes. Resolver isso libera seus KPIs corretamente.',
      'cta_principal', 'Conciliar agora',
      'cta_secundario', 'Falar com IA',
      'rota_principal', '/dashboard/conciliacao',
      'rota_secundaria', '/dashboard/consultor-ia?contexto=conciliacao'
    );
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'tipo', 'estavel',
    'titulo', 'Tudo em dia',
    'texto', 'Sem acoes urgentes detectadas. Aproveite pra planejar o proximo mes ou revisar contratos recorrentes.',
    'cta_principal', 'Ver contratos recorrentes',
    'cta_secundario', 'Falar com IA',
    'rota_principal', '/dashboard/contratos-recorrentes',
    'rota_secundaria', '/dashboard/consultor-ia'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_ge_next_best_action(uuid) TO authenticated;
COMMENT ON FUNCTION public.fn_ge_next_best_action(uuid) IS
'Consultor IA · próxima ação determinística. Universal RD-38. PR 2 23/05/2026.';
