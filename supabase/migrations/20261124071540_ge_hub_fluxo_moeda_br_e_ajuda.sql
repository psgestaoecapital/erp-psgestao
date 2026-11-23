-- GE · Hub landing (/dashboard/gestao-empresarial) · widget "Fluxo de Caixa"
-- GAP 1 (PDCA auditor_pdca_2, 19/11, RD-38): valor_formatado saía em formato US
--   ("R$ 1,648.06") porque TO_CHAR(..., 'FM999G999G990D00') usa o lc_numeric do
--   servidor (G=',' D='.'). Em tela financeira a vírgula vira decimal e engana.
--   Correção: usar o helper central fn_brl(numeric) (IMMUTABLE, máscara literal
--   ',.' + translate — independente de locale) → "R$ 1.648,06".
-- RD-95: cada KPI do widget passa a carregar ajuda_chave (o "?") e as chaves são
--   semeadas em erp_ajuda_campo para a rota do hub.
-- Aditiva: só troca formatação e acrescenta campo ao payload; nenhum cálculo,
--   nenhuma linha/dado de cliente é alterado.

CREATE OR REPLACE FUNCTION public.fn_gestao_empresarial_widget_fluxo_caixa(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
        'valor_formatado', 'R$ ' || fn_brl(v_saldo_final),
        'ajuda_chave', 'ge.hub.fluxo.saldo_final',
        'positivo', (v_saldo_final >= 0)
      ),
      'kpis_secundarios', jsonb_build_array(
        jsonb_build_object('label', 'Saldo Inicial', 'valor', v_saldo_inicial,
          'valor_formatado', 'R$ ' || fn_brl(v_saldo_inicial),
          'ajuda_chave', 'ge.hub.fluxo.saldo_inicial'),
        jsonb_build_object('label', 'Entradas 30d', 'valor', v_entradas_30d,
          'valor_formatado', 'R$ ' || fn_brl(v_entradas_30d),
          'ajuda_chave', 'ge.hub.fluxo.entradas'),
        jsonb_build_object('label', 'Saídas 30d', 'valor', v_saidas_30d,
          'valor_formatado', 'R$ ' || fn_brl(v_saidas_30d),
          'ajuda_chave', 'ge.hub.fluxo.saidas'),
        jsonb_build_object('label', 'Dias Negativos', 'valor', v_dias_negativos,
          'ajuda_chave', 'ge.hub.fluxo.dias_negativos',
          'critico', (v_dias_negativos > 5))
      ),
      'sparkline', COALESCE(v_sparkline, '[]'::jsonb),
      'rota_acao', '/dashboard/previsao?area=gestao_empresarial',
      'cta_label', 'Ver projeção completa →'
    );
  END IF;

  -- TENTATIVA 1.5: pendências em erp_receber/erp_pagar (briefing CEO foundational)
  SELECT EXISTS (
    SELECT 1 FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
    UNION ALL
    SELECT 1 FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  ) INTO v_tem_pendencias;

  IF v_tem_pendencias OR v_saldo_inicial <> 0 THEN
    SELECT COALESCE(SUM(valor), 0) INTO v_entradas_30d
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) erp_receber
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

    SELECT COALESCE(SUM(valor), 0) INTO v_saidas_30d
    FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) erp_pagar
    WHERE company_id = p_company_id AND status = 'aberto'
      AND data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days';

    v_saldo_final := v_saldo_inicial + v_entradas_30d - v_saidas_30d;

    WITH dias AS (
      SELECT generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', '1 day')::date AS dia
    ),
    mov_dia AS (
      SELECT d.dia,
        COALESCE((SELECT SUM(valor) FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) er
          WHERE er.company_id=p_company_id AND er.status='aberto' AND er.data_vencimento=d.dia), 0) AS ent,
        COALESCE((SELECT SUM(valor) FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) ep
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
        'valor_formatado', 'R$ ' || fn_brl(v_saldo_final),
        'ajuda_chave', 'ge.hub.fluxo.saldo_final',
        'positivo', (v_saldo_final >= 0)
      ),
      'kpis_secundarios', jsonb_build_array(
        jsonb_build_object('label', 'Saldo Inicial', 'valor', v_saldo_inicial,
          'valor_formatado', 'R$ ' || fn_brl(v_saldo_inicial),
          'ajuda_chave', 'ge.hub.fluxo.saldo_inicial'),
        jsonb_build_object('label', 'Entradas 30d', 'valor', v_entradas_30d,
          'valor_formatado', 'R$ ' || fn_brl(v_entradas_30d),
          'ajuda_chave', 'ge.hub.fluxo.entradas'),
        jsonb_build_object('label', 'Saídas 30d', 'valor', v_saidas_30d,
          'valor_formatado', 'R$ ' || fn_brl(v_saidas_30d),
          'ajuda_chave', 'ge.hub.fluxo.saidas'),
        jsonb_build_object('label', 'Dias Negativos', 'valor', v_dias_negativos,
          'ajuda_chave', 'ge.hub.fluxo.dias_negativos',
          'critico', (v_dias_negativos > 5))
      ),
      'sparkline', COALESCE(v_sparkline, '[]'::jsonb),
      'rota_acao', '/dashboard/previsao?area=gestao_empresarial',
      'cta_label', 'Ver projeção completa →'
    );
  END IF;

  -- TENTATIVA 2: RESUMO REALIZADO
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
        'valor_formatado', 'R$ ' || fn_brl(v_saldo_mes),
        'ajuda_chave', 'ge.hub.fluxo.saldo_mes',
        'positivo', (v_saldo_mes >= 0)),
      'kpis_secundarios', jsonb_build_array(
        jsonb_build_object('label', 'Entradas ' || v_label_mes, 'valor', v_entradas_mes,
          'valor_formatado', 'R$ ' || fn_brl(v_entradas_mes),
          'ajuda_chave', 'ge.hub.fluxo.entradas'),
        jsonb_build_object('label', 'Saídas ' || v_label_mes, 'valor', v_saidas_mes,
          'valor_formatado', 'R$ ' || fn_brl(v_saidas_mes),
          'ajuda_chave', 'ge.hub.fluxo.saidas'),
        jsonb_build_object('label', 'Saldo Acumulado Total', 'valor', v_saldo_acumulado_total,
          'valor_formatado', 'R$ ' || fn_brl(v_saldo_acumulado_total),
          'ajuda_chave', 'ge.hub.fluxo.saldo_acumulado', 'critico', false)),
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
$function$;

-- RD-95: chaves de ajuda ("?") dos indicadores do widget Fluxo de Caixa do hub GE.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('ge.hub.fluxo.saldo_final', '/dashboard/gestao-empresarial', 'Fluxo de Caixa', 'gestao_empresarial', 1,
   'Saldo final projetado',
   'Indicador automático — não é preenchido. Mostra quanto deve sobrar (ou faltar) no caixa ao fim dos próximos 30 dias.',
   'É o saldo de bancos de hoje somado às entradas previstas e menos as saídas previstas até 30 dias. Serve para antecipar aperto ou folga de caixa.',
   'Saldo de hoje R$ 16.348,19 + entradas R$ 3.014,02 − saídas R$ 17.714,15 = R$ 1.648,06.',
   'Achar que é o saldo de hoje: é a PROJEÇÃO do fim do período. Se estiver negativo, há risco de faltar dinheiro.'),
  ('ge.hub.fluxo.saldo_inicial', '/dashboard/gestao-empresarial', 'Fluxo de Caixa', 'gestao_empresarial', 2,
   'Saldo inicial',
   'Indicador automático. É a soma dos saldos atuais das contas bancárias marcadas para entrar no fluxo de caixa.',
   'Serve de ponto de partida da projeção: a partir dele somamos entradas e subtraímos saídas futuras.',
   'Duas contas com R$ 10.000,00 e R$ 6.348,19 somam saldo inicial R$ 16.348,19.',
   'Conta não marcada para entrar no fluxo de caixa (no cadastro da conta) não aparece aqui.'),
  ('ge.hub.fluxo.entradas', '/dashboard/gestao-empresarial', 'Fluxo de Caixa', 'gestao_empresarial', 3,
   'Entradas',
   'Indicador automático. Soma dos títulos a receber em aberto com vencimento dentro do período.',
   'Mostra quanto deve entrar no caixa, para comparar com as saídas e checar se o saldo se sustenta.',
   'Três boletos a receber de R$ 1.000,00 vencendo no mês somam entradas de R$ 3.000,00.',
   'Título já baixado/recebido não conta como entrada futura — ele já está no saldo inicial.'),
  ('ge.hub.fluxo.saidas', '/dashboard/gestao-empresarial', 'Fluxo de Caixa', 'gestao_empresarial', 4,
   'Saídas',
   'Indicador automático. Soma dos títulos a pagar em aberto com vencimento dentro do período.',
   'Mostra quanto deve sair do caixa, para antecipar meses em que as contas superam o que entra.',
   'Folha R$ 12.000,00 + fornecedores R$ 5.714,15 = saídas de R$ 17.714,15 no período.',
   'Conta já paga não é saída futura. Se faltou uma conta, lance-a em Pagar para a projeção ficar real.'),
  ('ge.hub.fluxo.dias_negativos', '/dashboard/gestao-empresarial', 'Fluxo de Caixa', 'gestao_empresarial', 5,
   'Dias negativos',
   'Indicador automático. Quantos dias, dentro dos próximos 30, o saldo acumulado fica abaixo de zero.',
   'Alerta de risco de caixa: dia negativo é dia em que o dinheiro não cobre as contas daquele dia.',
   'Se nos dias 12 e 13 o saldo acumulado fica negativo, o indicador mostra 2.',
   'Zero dias negativos não garante folga o mês todo — observe também o saldo final projetado.'),
  ('ge.hub.fluxo.saldo_mes', '/dashboard/gestao-empresarial', 'Fluxo de Caixa', 'gestao_empresarial', 6,
   'Saldo do mês (realizado)',
   'Indicador automático, exibido quando não há pendências futuras. É entradas menos saídas já realizadas no mês.',
   'Mostra o resultado de caixa efetivo do mês, sem depender de previsões.',
   'Entradas realizadas R$ 20.000,00 − saídas R$ 14.000,00 = saldo do mês R$ 6.000,00.',
   'É só do mês de referência; para o acumulado de todo o histórico veja "Saldo acumulado total".'),
  ('ge.hub.fluxo.saldo_acumulado', '/dashboard/gestao-empresarial', 'Fluxo de Caixa', 'gestao_empresarial', 7,
   'Saldo acumulado total',
   'Indicador automático (modo realizado). Soma de todos os saldos diários já lançados no histórico da empresa.',
   'Dá a posição de caixa acumulada ao longo do tempo, além do resultado do mês corrente.',
   'Se cada mês fechou positivo, o acumulado cresce mês a mês até o valor exibido.',
   'Não é o saldo do banco hoje (esse é o "Saldo inicial"); é o acumulado dos lançamentos de fluxo.')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem,
  rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, atualizado_em = now();
