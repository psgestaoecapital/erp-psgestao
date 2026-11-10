-- RD-98 / consistência financeira: alinhar o burn rate (despesa mensal) do alerta proativo
-- ao MESMO cálculo do termômetro de saúde (fn_ge_saude_financeira), para que "meses de caixa"
-- não divirja entre o número-manchete e os alertas.
--
-- Divergência provada no dado (RD-38, DEMO Construtora Modelo, 10/11):
--   - termômetro  = AVG(total por mês pago, COALESCE(valor_pago,valor)), janela >= 3 meses  -> R$ 3.444,40/mês
--   - alerta ANTES = SUM(valor_pago)/3.0, janela > 90 dias                                   -> R$ 1.148,13/mês
-- Quando há menos de 3 meses com pagamento, o /3.0 subestima a despesa e superestima os meses
-- de caixa (até 3x), contradizendo o termômetro. Esta migração passa o alerta a usar a MESMA
-- base do termômetro: média dos totais mensais, COALESCE(valor_pago,valor), janela >= 3 meses.
--
-- Mudança APENAS no cálculo de v_despesa_mensal. Nenhuma linha de dado de cliente é lida/alterada
-- fora do cálculo de leitura; função mantém SECURITY DEFINER + fn__guarda_empresa (RLS por empresa).

CREATE OR REPLACE FUNCTION public.fn_saude_alertas_proativos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alertas jsonb := '[]'::jsonb;
  v_saldo numeric;
  v_despesa_mensal numeric;
  v_meses_caixa numeric;
  v_inadimplencia_pct numeric;
  v_concentracao_cliente jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_saldo := fn_saldo_bancos_dinamico(ARRAY[p_company_id]);

  -- Despesa mensal = MESMA base do termômetro (fn_ge_saude_financeira): média dos totais
  -- pagos por mês (COALESCE(valor_pago,valor)), janela dos últimos 3 meses. Assim o
  -- "meses de caixa" do alerta bate com o número-manchete da Saúde Financeira.
  SELECT COALESCE(AVG(total_mes), 0) INTO v_despesa_mensal
  FROM (
    SELECT DATE_TRUNC('month', data_pagamento) AS mes, SUM(COALESCE(valor_pago, valor)) AS total_mes
    FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar
    WHERE company_id = p_company_id
      AND status = 'pago'
      AND data_pagamento >= CURRENT_DATE - INTERVAL '3 months'
    GROUP BY DATE_TRUNC('month', data_pagamento)
  ) sub;

  v_meses_caixa := CASE WHEN v_despesa_mensal > 0
                        THEN v_saldo / v_despesa_mensal
                        ELSE NULL END;

  -- Alerta 1 · Meses de caixa
  IF v_meses_caixa IS NOT NULL AND v_meses_caixa < 1 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'critico',
      'icone', '🔴',
      'titulo', 'Caixa baixo',
      'mensagem', FORMAT('Você tem menos de 1 mês de caixa (%s meses). Risco operacional alto.', ROUND(v_meses_caixa, 1)),
      'acao_sugerida', 'Reduza despesas não-essenciais E acelere recebimentos.'
    );
  ELSIF v_meses_caixa IS NOT NULL AND v_meses_caixa < 3 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'aviso',
      'icone', '🟡',
      'titulo', 'Reserva limitada',
      'mensagem', FORMAT('Você tem %s meses de caixa. Recomendado: pelo menos 3 meses.', ROUND(v_meses_caixa, 1)),
      'acao_sugerida', 'Considere reservar % do faturamento mensal.'
    );
  END IF;

  -- Alerta 2 · Inadimplência — MESMA definição do termômetro (status IN ('aberto','vencido'))
  SELECT
    CASE WHEN SUM(valor) > 0
         THEN SUM(CASE WHEN data_vencimento < CURRENT_DATE AND status IN ('aberto','vencido') THEN valor ELSE 0 END) * 100.0 / SUM(valor)
         ELSE 0 END
  INTO v_inadimplencia_pct
  FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id;

  IF v_inadimplencia_pct > 10 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'critico',
      'icone', '🔴',
      'titulo', 'Inadimplência alta',
      'mensagem', FORMAT('%s%% da carteira está inadimplente.', ROUND(v_inadimplencia_pct, 0)),
      'acao_sugerida', 'Priorize cobrança ativa nas atrasadas acima de 30 dias.'
    );
  END IF;

  -- Alerta 3 · Concentração de receita — MESMA base do termômetro:
  -- recebido 90 dias, cliente_id NÃO nulo, COALESCE(valor_pago,valor), top por total, arredondado a 0 casas.
  -- Só dispara quando há um cliente NOMEADO (o termômetro mostra "—" quando não há nome; o alerta então
  -- silencia, em vez de contradizer com um balde sem cliente).
  WITH receita_cliente AS (
    SELECT cliente_id, cliente_nome, SUM(COALESCE(valor_pago, valor)) AS total
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id
      AND status IN ('pago', 'recebido')
      AND data_pagamento >= CURRENT_DATE - INTERVAL '90 days'
      AND cliente_id IS NOT NULL
    GROUP BY cliente_id, cliente_nome
  ),
  total_receita AS (
    SELECT SUM(total) AS total FROM receita_cliente
  )
  SELECT jsonb_build_object(
    'cliente_top_id', cliente_id,
    'cliente_top_nome', cliente_nome,
    'pct', ROUND(total / NULLIF((SELECT total FROM total_receita), 0) * 100, 0)
  )
  INTO v_concentracao_cliente
  FROM receita_cliente
  ORDER BY total DESC
  LIMIT 1;

  IF v_concentracao_cliente IS NOT NULL
     AND (v_concentracao_cliente ->> 'cliente_top_nome') IS NOT NULL
     AND (v_concentracao_cliente ->> 'pct')::numeric > 40 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'aviso',
      'icone', '🟡',
      'titulo', 'Concentração de receita',
      'mensagem', FORMAT('%s representa %s%% da receita recebida (90 dias). Risco de dependência.',
                         v_concentracao_cliente ->> 'cliente_top_nome', v_concentracao_cliente ->> 'pct'),
      'acao_sugerida', 'Diversifique a base de clientes.'
    );
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_atual', v_saldo,
    'despesa_mensal_media', v_despesa_mensal,
    'meses_caixa', v_meses_caixa,
    'inadimplencia_pct', v_inadimplencia_pct,
    'concentracao_top_cliente', v_concentracao_cliente,
    'total_alertas', jsonb_array_length(v_alertas),
    'alertas', v_alertas
  );
END;
$function$;

-- Permissões (check:fn-guards · régua revoke_anon): função SECURITY DEFINER com guarda de empresa
-- (PERFORM fn__guarda_empresa no corpo); fechada a anon/PUBLIC, aberta só a quem está logado e ao serviço,
-- igual ao ACL vivo (authenticated, service_role). Sem mudança de quem já podia chamar.
REVOKE ALL ON FUNCTION public.fn_saude_alertas_proativos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saude_alertas_proativos(uuid) TO authenticated, service_role;
