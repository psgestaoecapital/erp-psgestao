-- [Gean/Jordana · Canal PS · msg eng_chefe 4c1cb3c0] Previsão de caixa não deve projetar título renegociado
--
-- Requisito explícito (chamado reencaminhado): o título original renegociado (status 'renegociado',
-- substituído pelos novos títulos da renegociação) NÃO pode aparecer fora da tela de Renegociação —
-- nem na conciliação, nem em Receitas a Receber, nem no fluxo de caixa, nem na PREVISÃO DE CAIXA.
--
-- fn_fluxo_caixa_diario (PR #4434) e fn_inadimplentes_por_status (PR #4433) já foram corrigidas.
-- fn_fluxo_caixa_projecao (tela "Previsão de caixa") projeta os títulos a receber "comprometidos" por
-- data_vencimento usando status NOT IN ('pago','recebido','cancelado','previsto') — a lista NÃO exclui
-- 'renegociado'. A função irmã gerar_previsao_fluxo_caixa já usa status IN ('aberto','vencido','parcial')
-- (não inclui 'renegociado'), então esta é a única projeção de caixa fora de padrão.
--
-- Prova no dado (RD-38), 11/11/2026: a janela da projeção é apenas futura (CURRENT_DATE..+90d) e hoje NÃO
-- há nenhum título 'renegociado' a receber com vencimento nessa janela (0 em todas as empresas) — ou seja,
-- NÃO há vazamento acontecendo agora. Esta migration fecha o risco LATENTE (renegociar um título a vencer
-- faria o título original vazar para a previsão) e alinha a projeção ao requisito e às funções irmãs.
-- Mudança MÍNIMA e aditiva: só acrescenta 'renegociado' ao NOT IN do lado "a receber comprometido".
-- Lado a pagar, 'previsto' (linha própria), recorrentes e saldo inicial ficam intactos.

CREATE OR REPLACE FUNCTION public.fn_fluxo_caixa_projecao(p_company_id uuid, p_dias_futuro integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_saldo_atual numeric;
  v_resultado jsonb := '[]'::jsonb;
  v_saldo_projetado numeric;        -- SEM previsão (o oficial — decide pagamento)
  v_saldo_com_previsao numeric;     -- cenário: e SE tudo previsto virar nota
  v_dia record;
  v_data_negativo date := NULL;
BEGIN
  v_saldo_atual := fn_saldo_bancos_dinamico(ARRAY[p_company_id]);
  v_saldo_projetado := v_saldo_atual;
  v_saldo_com_previsao := v_saldo_atual;

  FOR v_dia IN
    WITH dias AS (
      SELECT generate_series(CURRENT_DATE, CURRENT_DATE + p_dias_futuro, INTERVAL '1 day') AS d
    )
    SELECT
      d::date AS data,
      -- COMPROMETIDO (a receber real): status NOT IN pago/recebido/cancelado/previsto E NUNCA 'renegociado'
      -- ('renegociado' = título original já substituído; só aparece na tela de Renegociação)
      COALESCE((SELECT SUM(valor) FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id
                AND data_vencimento = d::date
                AND status NOT IN ('pago', 'recebido', 'cancelado', 'previsto', 'renegociado')), 0) AS receitas_previstas,
      -- PREVISÃO (pedido ainda não faturado): LINHA SEPARADA — nunca entra no saldo comprometido
      COALESCE((SELECT SUM(valor) FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber WHERE company_id = p_company_id
                AND data_vencimento = d::date
                AND status = 'previsto'), 0) AS receitas_previsao,
      COALESCE((SELECT SUM(valor) FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar WHERE company_id = p_company_id
                AND data_vencimento = d::date
                AND status NOT IN ('pago', 'cancelado')), 0) AS despesas_previstas,
      COALESCE((SELECT SUM(COALESCE(c.valor_atual, c.valor_mensal, 0)) FROM erp_contratos c
                WHERE c.company_id = p_company_id
                  AND LOWER(c.status::text) = 'ativo'
                  AND EXTRACT(DAY FROM d::date) = COALESCE(c.dia_vencimento, 10)
                  AND d::date > COALESCE(c.data_primeiro_vencimento, c.data_inicio)
                  AND (c.data_fim IS NULL OR d::date <= c.data_fim)), 0) AS receitas_recorrentes
    FROM dias
  LOOP
    -- saldo OFICIAL: comprometido + recorrente - despesa. 'previsto' NÃO entra.
    v_saldo_projetado := v_saldo_projetado
                        + v_dia.receitas_previstas
                        + v_dia.receitas_recorrentes
                        - v_dia.despesas_previstas;
    -- cenário COM previsão (segundo número, claramente projeção)
    v_saldo_com_previsao := v_saldo_com_previsao
                        + v_dia.receitas_previstas
                        + v_dia.receitas_recorrentes
                        + v_dia.receitas_previsao
                        - v_dia.despesas_previstas;

    IF v_saldo_projetado < 0 AND v_data_negativo IS NULL THEN
      v_data_negativo := v_dia.data;
    END IF;

    v_resultado := v_resultado || jsonb_build_object(
      'data', v_dia.data,
      'receitas_previstas', v_dia.receitas_previstas,
      'receitas_previsao', v_dia.receitas_previsao,   -- previsto (ainda não faturado) — linha própria
      'receitas_recorrentes', v_dia.receitas_recorrentes,
      'despesas_previstas', v_dia.despesas_previstas,
      'movimento_projetado', v_dia.receitas_previstas + v_dia.receitas_recorrentes - v_dia.despesas_previstas,
      'saldo_projetado', v_saldo_projetado,                       -- SEM previsão
      'saldo_projetado_com_previsao', v_saldo_com_previsao,       -- cenário
      'alerta_negativo', v_saldo_projetado < 0
    );
  END LOOP;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'saldo_atual', v_saldo_atual,
    'saldo_final_projetado', v_saldo_projetado,                   -- oficial, SEM previsão
    'saldo_final_com_previsao', v_saldo_com_previsao,             -- cenário (projeção)
    'total_previsao_nao_faturada', (SELECT COALESCE(SUM((d ->> 'receitas_previsao')::numeric),0) FROM jsonb_array_elements(v_resultado) d),
    'data_primeiro_negativo', v_data_negativo,
    'dias_ate_negativo', CASE WHEN v_data_negativo IS NOT NULL
                              THEN (v_data_negativo - CURRENT_DATE)
                              ELSE NULL END,
    'alerta_ia', CASE
      WHEN v_data_negativo IS NOT NULL THEN
        FORMAT('⚠️ Você ficará negativo em %s dias (%s). Considere antecipar receivables ou postergar despesas.',
               v_data_negativo - CURRENT_DATE, v_data_negativo)
      WHEN v_saldo_projetado > v_saldo_atual * 2 THEN
        FORMAT('💰 Caixa projetado +%s%% em %s dias. Considere reinvestir ou aplicar.',
               ROUND(((v_saldo_projetado / NULLIF(v_saldo_atual, 0)) - 1) * 100), p_dias_futuro)
      ELSE 'Caixa estável no período. Sem alertas.'
    END,
    'dias', v_resultado
  );
END;
$function$;

-- check_fn_guards (Regra 1): REVOKE anon na fn SECURITY DEFINER.
-- Espelha a ACL viva de hoje {postgres(owner), service_role} — authenticated NÃO está na ACL viva desta
-- função, então NÃO é concedido aqui (nenhuma mudança de acesso; CREATE OR REPLACE preserva a ACL).
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_projecao(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_projecao(uuid, integer) TO service_role;
