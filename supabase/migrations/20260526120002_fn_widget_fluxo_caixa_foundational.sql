-- BUG #2 dashboard residual (CEO 26/05/2026 batch · cristalização 255d8f9b)
-- Widget Fluxo de Caixa começava sparkline em R$ 0 e mostrava kpi_principal -965
-- (movimentação líquida 30d) em vez de saldo projetado real (saldo_inicial + líquido).
-- Aplicado via MCP apply_migration · este arquivo é rastreio histórico.
--
-- Mudanças:
-- 1. Modo "projecao": SOMA saldo_inicial bancário (fn_saldo_bancos_dinamico)
--    no kpi_principal e nos pontos da sparkline (acumulado real).
-- 2. Nova TENTATIVA 1.5: se v_psgc_fluxo_projecao vazia mas há erp_receber/
--    erp_pagar com vencimentos próximos 30d, projeta a partir dessas tabelas
--    (briefing CEO foundational · fonte real de dados pós PR #162).
-- 3. Shape JSON idêntico ao anterior · FluxoCaixaWidget.tsx sem mudança.
--
-- Validação empírica (cristalização banco 5ac6a770):
--   PS LTDA: kpi_principal.valor = 24.119,93 positivo (era -965 negativo)
--     · saldo_inicial=25.084,93, entradas 30d=0, saídas 30d=965
--     · briefing supôs 35.619 ao incluir vencidos como "entradas 30d";
--       realidade: vencidos estão no passado · não no próximos 30d.
--   PS Consultoria: kpi_principal.valor = 2.854,37 (bate briefing)
--     · saldo_inicial=2.954,27, entradas 30d=0, saídas 30d=99,90.

CREATE OR REPLACE FUNCTION public.fn_gestao_empresarial_widget_fluxo_caixa(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_saldo_inicial numeric := 0;
  v_tem_projecao boolean;
  v_tem_pendencias boolean;
  v_entradas_30d numeric := 0;
  v_saidas_30d numeric := 0;
  v_saldo_final numeric := 0;
  v_dias_negativos int := 0;
  v_sparkline jsonb;

  v_tem_realizado boolean;
  v_entradas_mes numeric;
  v_saidas_mes numeric;
  v_saldo_mes numeric;
  v_saldo_acumulado_total numeric;
  v_sparkline_realizado jsonb;
  v_data_ultimo_lancamento date;
  v_mes_referencia date;
  v_label_mes text;
BEGIN
  v_saldo_inicial := fn_saldo_bancos_dinamico(ARRAY[p_company_id]::uuid[]);

  SELECT COUNT(*) > 0 INTO v_tem_projecao
  FROM v_psgc_fluxo_projecao
  WHERE company_id = p_company_id
    AND data BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

  IF v_tem_projecao THEN
    SELECT
      COALESCE(SUM(entradas), 0),
      COALESCE(SUM(saidas), 0),
      COALESCE(SUM(saldo_dia), 0)
    INTO v_entradas_30d, v_saidas_30d, v_saldo_final
    FROM v_psgc_fluxo_projecao
    WHERE company_id = p_company_id
      AND data BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

    v_saldo_final := v_saldo_inicial + v_saldo_final;

    WITH proj AS (
      SELECT data, saldo_dia,
        v_saldo_inicial + SUM(saldo_dia) OVER (ORDER BY data) AS saldo_acumulado,
        ROW_NUMBER() OVER (ORDER BY data) AS rn
      FROM v_psgc_fluxo_projecao
      WHERE company_id = p_company_id
        AND data BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    ),
    com_zero AS (
      SELECT CURRENT_DATE AS data, v_saldo_inicial AS saldo_acumulado, 0 AS rn
      UNION ALL
      SELECT data, saldo_acumulado, rn::int FROM proj
    ),
    sample AS (
      SELECT data, saldo_acumulado FROM com_zero
      WHERE rn % GREATEST(CEIL(((SELECT MAX(rn) FROM com_zero))::numeric / 7)::int, 1) = 0
         OR rn = (SELECT MAX(rn) FROM com_zero)
      ORDER BY data LIMIT 10
    )
    SELECT jsonb_agg(jsonb_build_object('data', data, 'saldo', saldo_acumulado) ORDER BY data)
    INTO v_sparkline FROM sample;

    SELECT COUNT(*) INTO v_dias_negativos FROM (
      SELECT v_saldo_inicial + SUM(saldo_dia) OVER (ORDER BY data) AS s
      FROM v_psgc_fluxo_projecao
      WHERE company_id = p_company_id
        AND data BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    ) q WHERE s < 0;

    RETURN jsonb_build_object(
      'modo', 'projecao',
      'empty_state', false,
      'titulo', 'Fluxo de Caixa',
      'subtitulo', 'Projeção próximos 30 dias',
      'saldo_inicial', v_saldo_inicial,
      'kpi_principal', jsonb_build_object(
        'label', 'Saldo Final Projetado',
        'valor', v_saldo_final,
        'valor_formatado', 'R$ ' || TO_CHAR(v_saldo_final, 'FM999G999G990D00'),
        'positivo', (v_saldo_final >= 0)
      ),
      'kpis_secundarios', jsonb_build_array(
        jsonb_build_object('label', 'Saldo Inicial', 'valor', v_saldo_inicial,
          'valor_formatado', 'R$ ' || TO_CHAR(v_saldo_inicial, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Entradas 30d', 'valor', v_entradas_30d,
          'valor_formatado', 'R$ ' || TO_CHAR(v_entradas_30d, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Saídas 30d', 'valor', v_saidas_30d,
          'valor_formatado', 'R$ ' || TO_CHAR(v_saidas_30d, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Dias Negativos', 'valor', v_dias_negativos,
          'critico', (v_dias_negativos > 5))
      ),
      'sparkline', COALESCE(v_sparkline, '[]'::jsonb),
      'rota_acao', '/dashboard/previsao?area=gestao_empresarial',
      'cta_label', 'Ver projeção completa →'
    );
  END IF;

  -- TENTATIVA 1.5: pendências em erp_receber/erp_pagar (briefing CEO foundational)
  SELECT EXISTS (
    SELECT 1 FROM erp_receber
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    UNION ALL
    SELECT 1 FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  ) INTO v_tem_pendencias;

  IF v_tem_pendencias OR v_saldo_inicial <> 0 THEN
    SELECT COALESCE(SUM(valor), 0) INTO v_entradas_30d
    FROM erp_receber
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

    SELECT COALESCE(SUM(valor), 0) INTO v_saidas_30d
    FROM erp_pagar
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

    v_saldo_final := v_saldo_inicial + v_entradas_30d - v_saidas_30d;

    WITH dias AS (
      SELECT generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', '1 day')::date AS dia
    ),
    mov_dia AS (
      SELECT d.dia,
        COALESCE((SELECT SUM(valor) FROM erp_receber er
          WHERE er.company_id=p_company_id AND er.status='aberto' AND er.data_vencimento=d.dia), 0) AS ent,
        COALESCE((SELECT SUM(valor) FROM erp_pagar ep
          WHERE ep.company_id=p_company_id AND ep.status='aberto' AND ep.data_vencimento=d.dia), 0) AS sai
      FROM dias d
    ),
    acum AS (
      SELECT dia,
        v_saldo_inicial + SUM(ent - sai) OVER (ORDER BY dia) AS saldo_acum,
        ROW_NUMBER() OVER (ORDER BY dia) AS rn
      FROM mov_dia
    ),
    sample AS (
      SELECT dia AS data, saldo_acum AS saldo_acumulado FROM acum
      WHERE rn = 1 OR rn % 5 = 0 OR rn = (SELECT MAX(rn) FROM acum)
      ORDER BY dia LIMIT 10
    )
    SELECT jsonb_agg(jsonb_build_object('data', data, 'saldo', saldo_acumulado) ORDER BY data)
    INTO v_sparkline FROM sample;

    SELECT COUNT(*) INTO v_dias_negativos FROM acum WHERE saldo_acum < 0;

    RETURN jsonb_build_object(
      'modo', 'projecao',
      'empty_state', false,
      'titulo', 'Fluxo de Caixa',
      'subtitulo', 'Projeção próximos 30 dias',
      'saldo_inicial', v_saldo_inicial,
      'kpi_principal', jsonb_build_object(
        'label', 'Saldo Final Projetado',
        'valor', v_saldo_final,
        'valor_formatado', 'R$ ' || TO_CHAR(v_saldo_final, 'FM999G999G990D00'),
        'positivo', (v_saldo_final >= 0)
      ),
      'kpis_secundarios', jsonb_build_array(
        jsonb_build_object('label', 'Saldo Inicial', 'valor', v_saldo_inicial,
          'valor_formatado', 'R$ ' || TO_CHAR(v_saldo_inicial, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Entradas 30d', 'valor', v_entradas_30d,
          'valor_formatado', 'R$ ' || TO_CHAR(v_entradas_30d, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Saídas 30d', 'valor', v_saidas_30d,
          'valor_formatado', 'R$ ' || TO_CHAR(v_saidas_30d, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Dias Negativos', 'valor', v_dias_negativos,
          'critico', (v_dias_negativos > 5))
      ),
      'sparkline', COALESCE(v_sparkline, '[]'::jsonb),
      'rota_acao', '/dashboard/previsao?area=gestao_empresarial',
      'cta_label', 'Ver projeção completa →'
    );
  END IF;

  -- TENTATIVA 2: RESUMO REALIZADO (inalterada)
  SELECT COUNT(*) > 0, MAX(data) INTO v_tem_realizado, v_data_ultimo_lancamento
  FROM psgc_fluxo_realizado WHERE company_id = p_company_id;

  IF v_tem_realizado THEN
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM psgc_fluxo_realizado
        WHERE company_id = p_company_id AND data >= date_trunc('month', CURRENT_DATE)::date
      ) THEN date_trunc('month', CURRENT_DATE)::date
      ELSE date_trunc('month', v_data_ultimo_lancamento)::date
    END INTO v_mes_referencia;

    v_label_mes := CASE
      WHEN v_mes_referencia = date_trunc('month', CURRENT_DATE)::date THEN 'Mês Atual'
      ELSE 'Mês ' || TO_CHAR(v_mes_referencia, 'MM/YYYY')
    END;

    SELECT COALESCE(SUM(entradas), 0), COALESCE(SUM(saidas), 0), COALESCE(SUM(saldo_dia), 0)
    INTO v_entradas_mes, v_saidas_mes, v_saldo_mes
    FROM psgc_fluxo_realizado
    WHERE company_id = p_company_id
      AND data >= v_mes_referencia AND data < (v_mes_referencia + INTERVAL '1 month')::date;

    SELECT COALESCE(SUM(saldo_dia), 0) INTO v_saldo_acumulado_total
    FROM psgc_fluxo_realizado WHERE company_id = p_company_id;

    WITH meses_agregados AS (
      SELECT date_trunc('month', data)::date AS mes, SUM(saldo_dia) AS saldo_mes
      FROM psgc_fluxo_realizado
      WHERE company_id = p_company_id AND data >= (v_data_ultimo_lancamento - INTERVAL '6 months')::date
      GROUP BY 1
    ),
    meses_acumulados AS (
      SELECT mes, SUM(saldo_mes) OVER (ORDER BY mes) AS saldo_acumulado FROM meses_agregados
    )
    SELECT jsonb_agg(jsonb_build_object('data', mes, 'saldo', saldo_acumulado) ORDER BY mes)
    INTO v_sparkline_realizado FROM meses_acumulados;

    RETURN jsonb_build_object(
      'modo', 'realizado', 'empty_state', false,
      'titulo', 'Fluxo de Caixa Realizado',
      'subtitulo', 'Sem pendências futuras · Resumo ' || v_label_mes,
      'aviso', CASE
        WHEN v_data_ultimo_lancamento < CURRENT_DATE - INTERVAL '30 days' THEN
          'Último lançamento em ' || TO_CHAR(v_data_ultimo_lancamento, 'DD/MM/YYYY') ||
          '. Importe lançamentos novos para ver projeção futura.'
        ELSE 'Tudo em dia! Nenhuma pendência a pagar ou receber nos próximos 30 dias.'
      END,
      'kpi_principal', jsonb_build_object(
        'label', 'Saldo ' || v_label_mes, 'valor', v_saldo_mes,
        'valor_formatado', 'R$ ' || TO_CHAR(v_saldo_mes, 'FM999G999G990D00'),
        'positivo', (v_saldo_mes >= 0)),
      'kpis_secundarios', jsonb_build_array(
        jsonb_build_object('label', 'Entradas ' || v_label_mes, 'valor', v_entradas_mes,
          'valor_formatado', 'R$ ' || TO_CHAR(v_entradas_mes, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Saídas ' || v_label_mes, 'valor', v_saidas_mes,
          'valor_formatado', 'R$ ' || TO_CHAR(v_saidas_mes, 'FM999G999G990D00')),
        jsonb_build_object('label', 'Saldo Acumulado Total', 'valor', v_saldo_acumulado_total,
          'valor_formatado', 'R$ ' || TO_CHAR(v_saldo_acumulado_total, 'FM999G999G990D00'), 'critico', false)),
      'sparkline', COALESCE(v_sparkline_realizado, '[]'::jsonb),
      'rota_acao', '/dashboard/analises?area=gestao_empresarial',
      'cta_label', 'Ver análises completas →'
    );
  END IF;

  RETURN jsonb_build_object(
    'modo', 'empty', 'empty_state', true,
    'mensagem', 'Sem dados de fluxo de caixa para esta empresa',
    'sub_mensagem', 'Importe lançamentos a pagar e receber em "Importer Universal" para começar',
    'rota_acao', '/dashboard/importar-universal?area=gestao_empresarial',
    'cta_label', 'Importar lançamentos →'
  );
END;
$$;
