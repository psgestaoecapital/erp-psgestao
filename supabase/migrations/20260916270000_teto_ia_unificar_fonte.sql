-- TETO DE IA · unificar a FONTE do gasto de auditoria + documentar quem governa o quê.
-- Decisão do CEO: teto de auditoria US$ 3/dia · US$ 20/mês (gold sub-teto mantém US$ 3/dia).
--
-- Contexto (provado no dado, RD-38/RD-44): existiam TRÊS controles confundidos como "três verdades":
--   #1 anthropic_budget_control  → teto REAL dos robôs de auditoria (Insight camada 3 + Gold camada 2).
--                                   Contador DERIVADO de system_screens_insights + gold_camada2_validacoes,
--                                   recalculado por fn_recalcular_budget_anthropic ANTES de cada disparo
--                                   (fn_disparar_insight_auditor) — logo o cache custo_usd_hoje é só display,
--                                   nunca a decisão; o teto NÃO está furado.
--   #2 robo_budget_config        → teto de IA de PRODUTO (features do cliente) via aiGuardedCall→
--                                   fn_budget_pode_executar; contador em robo_budget_consumo_diario. ESCOPO
--                                   SEPARADO (não é robô de auditoria) — segue independente.
--   #3 fn_dev_vertical_orcamento → botão ④ da Central. TINHA teto hardcode US$1/US$5 e contava só os cliques
--                                   (erp_dev_vertical_pedido) — um "teto" que nem era o real e barrou a varredura.
--
-- Este PR: a #3 passa a LER a #1 (fonte única de auditoria). A #2 fica separada de propósito.

-- 1) Teto de auditoria conforme decisão do CEO (idempotente; a produção já foi ajustada em dado).
UPDATE public.anthropic_budget_control
   SET limite_max_custo_usd_dia = 3.00,
       limite_max_custo_usd_mes = 20.00
       -- limite_gold_usd_dia mantém 3.00: o Gold é quem TESTA o sistema (camada 2). Observar; baixar só se comer o Insight.
 WHERE id = 1;

-- 2) O botão ④ da Central passa a ler TETO e GASTO da #1 (fonte única), não mais o hardcode US$1/US$5.
--    'gasto' vem da MESMA soma viva que fn_recalcular_budget_anthropic usa (system_screens_insights + gold),
--    calculada aqui em SQL puro (função read-only) para nunca depender do cache. 'custo_estimado' segue sendo
--    a estimativa incremental DESTA vertical (telas × US$0,013). Gate de leitura (PS admin) inalterado.
CREATE OR REPLACE FUNCTION public.fn_dev_vertical_orcamento(p_vertical text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT count(*)::int AS telas FROM public.system_screens s
    WHERE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END = p_vertical
  ),
  cap AS (
    SELECT limite_max_custo_usd_dia AS cap_dia, limite_max_custo_usd_mes AS cap_mes
    FROM public.anthropic_budget_control WHERE id = 1
  ),
  g AS (
    SELECT
      ( COALESCE((SELECT sum(claude_custo_usd) FROM public.system_screens_insights
                  WHERE analisado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),0)
      + COALESCE((SELECT sum(claude_custo_usd) FROM public.gold_camada2_validacoes
                  WHERE executado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),0) )::numeric AS gasto_dia,
      ( COALESCE((SELECT sum(claude_custo_usd) FROM public.system_screens_insights
                  WHERE to_char(analisado_em,'YYYY-MM') = to_char(now(),'YYYY-MM')),0)
      + COALESCE((SELECT sum(claude_custo_usd) FROM public.gold_camada2_validacoes
                  WHERE to_char(executado_em,'YYYY-MM') = to_char(now(),'YYYY-MM')),0) )::numeric AS gasto_mes
  )
  SELECT jsonb_build_object(
    'vertical', p_vertical, 'telas', t.telas,
    'custo_estimado', round(t.telas*0.013,2), 'tempo_min', GREATEST(1, round(t.telas*0.3)::int),
    'gasto_dia', round(g.gasto_dia,2), 'gasto_mes', round(g.gasto_mes,2),
    'cap_dia', cap.cap_dia, 'cap_mes', cap.cap_mes,
    'pode', ( t.telas > 0
              AND g.gasto_dia + round(t.telas*0.013,2) <= cap.cap_dia
              AND g.gasto_mes + round(t.telas*0.013,2) <= cap.cap_mes ),
    'motivo', CASE
      WHEN t.telas = 0 THEN 'Esta vertical não tem telas catalogadas para auditar.'
      WHEN g.gasto_dia + round(t.telas*0.013,2) > cap.cap_dia
        THEN format('Teto diário (US$ %s) seria estourado. Gasto hoje US$ %s.',
                    to_char(cap.cap_dia,'FM990.00'), to_char(round(g.gasto_dia,2),'FM990.00'))
      WHEN g.gasto_mes + round(t.telas*0.013,2) > cap.cap_mes
        THEN format('Teto mensal (US$ %s) seria estourado. Gasto no mês US$ %s.',
                    to_char(cap.cap_mes,'FM990.00'), to_char(round(g.gasto_mes,2),'FM990.00'))
      ELSE NULL END)
  FROM t, cap, g
  WHERE (auth.role() = 'service_role' OR public.fn_eh_ps_admin());
$function$;

-- 3) DOCUMENTAÇÃO — comentários que impedem o próximo (humano ou Claude) de confundir as fontes de novo (RD-51).
COMMENT ON TABLE  public.anthropic_budget_control IS
  'FONTE ÚNICA do teto de gasto de AUDITORIA (robôs: Insight camada 3 + Gold camada 2). Governa dia/mês + sub-teto Gold/dia. custo_usd_hoje/mes são CACHE derivado de system_screens_insights + gold_camada2_validacoes, recalculado por fn_recalcular_budget_anthropic ANTES de cada disparo (é display, não decisão). Lida pelo disparador e pela Central de Dev (fn_dev_vertical_orcamento). NÃO confundir com robo_budget_config (IA de produto).';
COMMENT ON TABLE  public.robo_budget_config IS
  'Teto de IA de PRODUTO (features embarcadas do cliente), via aiGuardedCall → fn_budget_pode_executar; contador em robo_budget_consumo_diario. ESCOPO SEPARADO dos robôs de auditoria. NÃO governa auditoria — esse teto é anthropic_budget_control.';
COMMENT ON TABLE  public.erp_dev_vertical_pedido IS
  'Log/pedido do botão ④ da Central (estimativa por clique, ~US$0,013/tela). NÃO é o contador do teto: o teto e o gasto reais vêm de anthropic_budget_control.';
COMMENT ON FUNCTION public.fn_dev_vertical_orcamento(text) IS
  'Orçamento do botão ④ da Central. Teto (cap_dia/cap_mes) e gasto (gasto_dia/gasto_mes) vêm de anthropic_budget_control — fonte única de auditoria, sem hardcode. custo_estimado = estimativa incremental desta vertical (telas × US$0,013).';
