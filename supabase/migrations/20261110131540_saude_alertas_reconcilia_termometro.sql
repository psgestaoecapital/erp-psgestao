-- PDCA GE · /dashboard/financeiro/saude · reconcilia os Alertas Proativos IA com o termômetro (RD-38)
--
-- Gap do auditor (09/11): na MESMA tela, o Alerta Proativo IA contradizia os KPIs/termômetro:
--   (1) CONCENTRAÇÃO: o gauge "Concentração receita" mostrava "—" (sem cliente nomeado) enquanto
--       o alerta dizia "Top cliente representa 77,4%". Causa provada no dado: fn_saude_alertas_proativos
--       agrupava por cliente_id SEM excluir NULL (o balde de recebimentos sem cliente virava um
--       "top cliente" fantasma de 100%) e somava valor cru em vez de COALESCE(valor_pago,valor).
--       Ex.: Oficina/Revenda/Alliance/Troian -> gauge "—", alerta 100% (balde NULL); Comércio GE DEMO
--       -> gauge 100% (Cliente Demo PF 12) vs alerta 56,3%.
--   (2) INADIMPLÊNCIA: o KPI/termômetro conta status IN ('aberto','vencido'); o alerta usava
--       status NOT IN ('pago','recebido','cancelado') (incluía 'parcial'/'renegociado'), divergindo.
--       Ex.: Comércio GE DEMO -> termômetro 25 contas/R$22.720,58 vs alerta 30/R$28.850,58.
--
-- Fonte da verdade = o termômetro fn_ge_saude_financeira. Este patch conforma a função ADVISORY
-- fn_saude_alertas_proativos à MESMA base (mesmos filtros e arredondamento), sem tocar no score nem
-- nos KPIs. Nenhum dado de cliente é lido/alterado além da agregação; aditiva/idempotente.

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

  SELECT COALESCE(SUM(valor_pago), 0) / 3.0 INTO v_despesa_mensal
  FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar
  WHERE company_id = p_company_id
    AND data_pagamento > CURRENT_DATE - INTERVAL '90 days'
    AND status = 'pago';

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

-- REVOKE anon explícito (gate check_fn_guards): a função é SECURITY DEFINER.
-- Idempotente: a ACL viva já é {authenticated, service_role} (anon sem grant).
REVOKE ALL ON FUNCTION public.fn_saude_alertas_proativos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saude_alertas_proativos(uuid) TO authenticated, service_role;
