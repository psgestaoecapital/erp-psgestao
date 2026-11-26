-- ge/DRE + contador + balanço gerencial + painel contador · RD-38 · CLASSE "renegociado"
-- Tela: /dashboard/financeiro/dre-consolidado · /dashboard/contador · /dashboard/gestao-empresarial/balanco-patrimonial
--
-- CORRECTNESS NÚCLEO (receita/recebível DOBRADA por título renegociado).
-- Quando um título é renegociado, o ORIGINAL permanece VIVO (deleted_at IS NULL,
-- status='renegociado', em_renegociacao=true) e nascem os títulos-filho 'aberto' que
-- o substituem. Qualquer soma de receita/recebível que exclua só 'cancelado' (e NÃO
-- 'renegociado') conta o fantasma -> DOBRA. Alinha com #6036 (resultado-por-negócio)
-- e fn_fluxo_caixa_diario, que já excluem renegociado.
--
-- PROVA RD-38 (DEMO GE b0700000-...-0004, renegociação edfce16e), medida no dado 24/11:
--   receber vivos status='renegociado' = 2 títulos = R$ 2.970,00
--   contador competência 2026 .......... COM bug R$ 1.599.268,50 -> CORRETO R$ 1.596.298,50 (-2.970,00)
--   balanço "contas a receber" ......... COM bug - CORRETO = exatamente -2.970,00
--   erp_pagar status='renegociado' em produção = 0 linhas -> ramo PAGAR intacto (sem dado vivo).
--
-- FIX (ADITIVO, uniforme, NÃO toca dado de cliente; apenas CREATE OR REPLACE de read-models):
--   acrescenta 'renegociado' à exclusão de status nas somas de RECEITA/RECEBÍVEL (erp_receber)
--   das funções abaixo. fn_psgc_dre_horizontal NÃO muda (agrega as outras -> herda a base corrigida).
-- Funções: fn_contador_resumo_competencia, fn_ge_painel_contador, fn_psgc_balanco_gerencial,
--   fn_psgc_dre_lancamentos, fn_psgc_dre_diario, fn_psgc_dre_horizontal_dia,
--   fn_psgc_dre_conciliacao, fn_psgc_dre_analise_pessoas, fn_truth_audit_dre.
-- RD-95/RD-98: telas de leitura, sem mudança de layout.

-- fn_contador_resumo_competencia(uuid,date)
CREATE OR REPLACE FUNCTION public.fn_contador_resumo_competencia(p_company_id uuid, p_mes_competencia date DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receitas_competencia numeric;
  v_despesas_competencia numeric;
  v_receitas_caixa numeric;
  v_despesas_caixa numeric;
  v_periodo_fim date;
BEGIN
  v_periodo_fim := (p_mes_competencia + INTERVAL '1 month' - INTERVAL '1 day')::date;
  
  -- Regime competencia
  SELECT COALESCE(SUM(valor), 0) INTO v_receitas_competencia
  FROM erp_receber 
  WHERE company_id = p_company_id 
    AND data_competencia BETWEEN p_mes_competencia AND v_periodo_fim
    AND status != 'cancelado' AND (status IS NULL OR status <> 'renegociado');
  
  SELECT COALESCE(SUM(valor), 0) INTO v_despesas_competencia
  FROM erp_pagar 
  WHERE company_id = p_company_id 
    AND data_competencia BETWEEN p_mes_competencia AND v_periodo_fim
    AND status != 'cancelado';
  
  -- Regime caixa
  SELECT COALESCE(SUM(valor_pago), 0) INTO v_receitas_caixa
  FROM erp_receber 
  WHERE company_id = p_company_id 
    AND data_pagamento BETWEEN p_mes_competencia AND v_periodo_fim
    AND status IN ('pago', 'recebido');
  
  SELECT COALESCE(SUM(valor_pago), 0) INTO v_despesas_caixa
  FROM erp_pagar 
  WHERE company_id = p_company_id 
    AND data_pagamento BETWEEN p_mes_competencia AND v_periodo_fim
    AND status = 'pago';
  
  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'mes_competencia', p_mes_competencia,
    'periodo', jsonb_build_object('inicio', p_mes_competencia, 'fim', v_periodo_fim),
    'competencia', jsonb_build_object(
      'receitas', v_receitas_competencia,
      'despesas', v_despesas_competencia,
      'resultado', v_receitas_competencia - v_despesas_competencia
    ),
    'caixa', jsonb_build_object(
      'receitas', v_receitas_caixa,
      'despesas', v_despesas_caixa,
      'resultado', v_receitas_caixa - v_despesas_caixa
    ),
    'diferenca_competencia_caixa', (v_receitas_competencia - v_despesas_competencia) - (v_receitas_caixa - v_despesas_caixa)
  );
END;
$function$;

-- fn_ge_painel_contador(uuid)
CREATE OR REPLACE FUNCTION public.fn_ge_painel_contador(p_contador_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresas jsonb;
  v_total_empresas int;
  v_total_receita_mes numeric := 0;
  v_total_inadimplencia numeric := 0;
  v_total_obrigacoes_vencer int := 0;
  v_alertas_criticos jsonb;
BEGIN
  -- Buscar todas as empresas do contador
  WITH empresas_contador AS (
    SELECT cc.empresa_id AS company_id, c.razao_social, c.cnpj
    FROM contador_clientes cc
    JOIN companies c ON c.id = cc.empresa_id
    WHERE cc.contador_id = p_contador_id
      AND COALESCE(cc.ativo, true) = true
  ),
  metricas AS (
    SELECT
      ec.company_id,
      ec.razao_social,
      ec.cnpj,
      -- Receita do mês (psgc_dre receita_bruta)
      COALESCE((
        SELECT SUM(valor)
        FROM psgc_dre
        WHERE company_id = ec.company_id
          AND psgc_codigo LIKE '1.%'
          AND ano = EXTRACT(YEAR FROM CURRENT_DATE)
          AND mes = EXTRACT(MONTH FROM CURRENT_DATE)
          AND regime = 'competencia'
      ), 0) AS receita_mes,
      -- Inadimplência (erp_receber vencido)
      COALESCE((
        SELECT SUM(valor)
        FROM erp_receber
        WHERE company_id = ec.company_id
          AND status NOT IN ('recebido','pago','renegociado')
          AND COALESCE(status,'') != 'orcamento'
          AND data_vencimento < CURRENT_DATE
      ), 0) AS inadimplencia,
      -- Obrigações próximas (próximos 7 dias)
      COALESCE((
        SELECT COUNT(*)
        FROM fiscal_calendario
        WHERE company_id = ec.company_id
          AND status != 'pago'
          AND vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      ), 0) AS obrigacoes_proximas,
      -- Alertas críticos (consolidação)
      (
        SELECT COUNT(*)
        FROM alertas_contador
        WHERE empresa_id = ec.company_id
          AND COALESCE(resolvido, false) = false
      ) AS alertas_ativos
    FROM empresas_contador ec
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'company_id', company_id,
        'razao_social', razao_social,
        'cnpj', cnpj,
        'receita_mes', receita_mes,
        'inadimplencia', inadimplencia,
        'obrigacoes_proximas', obrigacoes_proximas,
        'alertas_ativos', alertas_ativos,
        'criticidade', CASE
          WHEN alertas_ativos > 0 OR obrigacoes_proximas > 2 THEN 'critica'
          WHEN inadimplencia > 0 OR obrigacoes_proximas > 0 THEN 'alerta'
          ELSE 'normal'
        END
      )
      ORDER BY 
        CASE WHEN alertas_ativos > 0 THEN 0 ELSE 1 END,
        razao_social
    ),
    COUNT(*)::int,
    COALESCE(SUM(receita_mes), 0),
    COALESCE(SUM(inadimplencia), 0),
    COALESCE(SUM(obrigacoes_proximas), 0)::int
  INTO v_empresas, v_total_empresas, v_total_receita_mes, v_total_inadimplencia, v_total_obrigacoes_vencer
  FROM metricas;

  -- Alertas críticos consolidados (top 10)
  WITH empresas_contador AS (
    SELECT cc.empresa_id FROM contador_clientes cc
    WHERE cc.contador_id = p_contador_id AND COALESCE(cc.ativo, true) = true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'empresa_id', a.empresa_id,
      'tipo', a.tipo,
      'mensagem', a.mensagem,
      'criticidade', a.criticidade,
      'criado_em', a.created_at
    )
    ORDER BY a.created_at DESC
  )
  INTO v_alertas_criticos
  FROM alertas_contador a
  WHERE a.empresa_id IN (SELECT empresa_id FROM empresas_contador)
    AND COALESCE(a.resolvido, false) = false
  LIMIT 10;

  -- Registrar acesso (LGPD audit)
  INSERT INTO contador_acessos_log (contador_id, acao, detalhes, created_at)
  VALUES (p_contador_id, 'consulta_painel', jsonb_build_object('empresas_total', v_total_empresas), NOW());

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_empresas', COALESCE(v_total_empresas, 0),
      'receita_consolidada_mes', v_total_receita_mes,
      'inadimplencia_consolidada', v_total_inadimplencia,
      'obrigacoes_proximas_7d', v_total_obrigacoes_vencer
    ),
    'empresas', COALESCE(v_empresas, '[]'::jsonb),
    'alertas_criticos', COALESCE(v_alertas_criticos, '[]'::jsonb)
  );
END;
$function$;

-- fn_psgc_balanco_gerencial(uuid[],date)
CREATE OR REPLACE FUNCTION public.fn_psgc_balanco_gerencial(p_company_ids uuid[], p_data_corte date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_data date := COALESCE(p_data_corte, CURRENT_DATE);
  v_caixa numeric := 0; v_contas_receber numeric := 0; v_estoque numeric := 0;
  v_outros_ac numeric := 0; v_ativo_circulante numeric := 0;
  v_realizavel_lp numeric := 0; v_imobilizado numeric := 0; v_intangivel numeric := 0;
  v_ativo_nao_circulante numeric := 0; v_ativo_total numeric := 0;
  v_fornecedores numeric := 0; v_emprestimos_cp numeric := 0;
  v_obrigacoes_fiscais numeric := 0; v_obrigacoes_trabalhistas numeric := 0;
  v_outros_pc numeric := 0; v_passivo_circulante numeric := 0;
  v_emprestimos_lp numeric := 0; v_passivo_nao_circulante numeric := 0;
  v_capital_social numeric := 0; v_lucros_acumulados numeric := 0;
  v_patrimonio_liquido numeric := 0;
BEGIN
  -- Caixa: último saldo do fluxo realizado por empresa
  SELECT COALESCE(SUM(saldo_dia), 0) INTO v_caixa
  FROM (
    SELECT DISTINCT ON (company_id) saldo_dia
    FROM psgc_fluxo_realizado
    WHERE company_id = ANY(p_company_ids) AND data <= v_data
    ORDER BY company_id, data DESC
  ) t;
  
  -- AR
  SELECT COALESCE(SUM(valor), 0) INTO v_contas_receber
  FROM erp_receber
  WHERE company_id = ANY(p_company_ids)
    AND status NOT IN ('recebido','pago','cancelado','CANCELADO','renegociado');
  
  -- Imobilizado e Intangível: se balanco_patrimonial tiver dados manuais
  SELECT 
    COALESCE(SUM(valor) FILTER (WHERE grupo ILIKE '%imobiliz%'), 0),
    COALESCE(SUM(valor) FILTER (WHERE grupo ILIKE '%intangiv%' OR grupo ILIKE '%intangível%'), 0)
  INTO v_imobilizado, v_intangivel
  FROM balanco_patrimonial
  WHERE company_id = ANY(p_company_ids)
    AND lado = 'ativo';
  
  v_ativo_circulante := v_caixa + v_contas_receber + v_estoque + v_outros_ac;
  v_ativo_nao_circulante := v_realizavel_lp + v_imobilizado + v_intangivel;
  v_ativo_total := v_ativo_circulante + v_ativo_nao_circulante;
  
  -- AP separando obrigações fiscais
  SELECT 
    COALESCE(SUM(valor) FILTER (
      WHERE NOT (fornecedor_nome ILIKE '%inss%' OR fornecedor_nome ILIKE '%simples%'
                 OR fornecedor_nome ILIKE '%fgts%' OR fornecedor_nome ILIKE '%das%'
                 OR fornecedor_nome ILIKE '%irrf%' OR fornecedor_nome ILIKE '%pis%'
                 OR fornecedor_nome ILIKE '%cofins%' OR fornecedor_nome ILIKE '%csll%')
    ), 0),
    COALESCE(SUM(valor) FILTER (
      WHERE fornecedor_nome ILIKE '%inss%' OR fornecedor_nome ILIKE '%simples%'
         OR fornecedor_nome ILIKE '%fgts%' OR fornecedor_nome ILIKE '%das%'
         OR fornecedor_nome ILIKE '%irrf%' OR fornecedor_nome ILIKE '%pis%'
         OR fornecedor_nome ILIKE '%cofins%' OR fornecedor_nome ILIKE '%csll%'
    ), 0)
  INTO v_fornecedores, v_obrigacoes_fiscais
  FROM erp_pagar
  WHERE company_id = ANY(p_company_ids)
    AND status NOT IN ('pago','cancelado','CANCELADO');
  
  SELECT COALESCE(SUM(capital_social), 0) INTO v_capital_social
  FROM companies WHERE id = ANY(p_company_ids);
  
  v_passivo_circulante := v_fornecedores + v_emprestimos_cp + v_obrigacoes_fiscais + v_obrigacoes_trabalhistas + v_outros_pc;
  v_passivo_nao_circulante := v_emprestimos_lp;
  v_patrimonio_liquido := v_ativo_total - v_passivo_circulante - v_passivo_nao_circulante;
  v_lucros_acumulados := v_patrimonio_liquido - v_capital_social;
  
  RETURN jsonb_build_object(
    'data_corte', v_data,
    'ativo', jsonb_build_object(
      'circulante', jsonb_build_object(
        'caixa_equivalentes', v_caixa,
        'contas_a_receber', v_contas_receber,
        'estoques', v_estoque,
        'outros', v_outros_ac,
        'total', v_ativo_circulante
      ),
      'nao_circulante', jsonb_build_object(
        'realizavel_longo_prazo', v_realizavel_lp,
        'imobilizado', v_imobilizado,
        'intangivel', v_intangivel,
        'total', v_ativo_nao_circulante
      ),
      'total', v_ativo_total
    ),
    'passivo', jsonb_build_object(
      'circulante', jsonb_build_object(
        'fornecedores', v_fornecedores,
        'emprestimos_cp', v_emprestimos_cp,
        'obrigacoes_fiscais', v_obrigacoes_fiscais,
        'obrigacoes_trabalhistas', v_obrigacoes_trabalhistas,
        'outros', v_outros_pc,
        'total', v_passivo_circulante
      ),
      'nao_circulante', jsonb_build_object(
        'emprestimos_lp', v_emprestimos_lp,
        'total', v_passivo_nao_circulante
      ),
      'total', v_passivo_circulante + v_passivo_nao_circulante
    ),
    'patrimonio_liquido', jsonb_build_object(
      'capital_social', v_capital_social,
      'lucros_acumulados', v_lucros_acumulados,
      'total', v_patrimonio_liquido
    ),
    'tipo', 'gerencial_derivado'
  );
END $function$;

-- fn_psgc_dre_analise_pessoas(uuid[],date,date,text,text[],integer)
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_analise_pessoas(p_company_ids uuid[], p_mes_ini date, p_mes_fim date, p_regime text DEFAULT 'competencia'::text, p_psgc_codigos text[] DEFAULT NULL::text[], p_top integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regime text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini date := date_trunc('month', p_mes_ini)::date;
  v_fim date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_top int := GREATEST(COALESCE(p_top,15), 1);
  v_pode boolean;
  v_meses jsonb; v_contas jsonb; v_dre_total numeric; v_dre_por_mes jsonb; v_pessoas jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada'); END IF;
  IF p_psgc_codigos IS NULL OR array_length(p_psgc_codigos,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma conta informada'); END IF;
  -- mesma guarda de acesso da fn_psgc_dre_lancamentos
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo'); END IF;

  -- LGPD: salário é dado sensível — nomes/valores por pessoa só p/ administrador, sócio e financeiro de CADA empresa pedida.
  -- por EMPRESA: o papel privilegiado tem de valer em TODAS as empresas pedidas (financeiro de outra empresa não vê salário por nome).
  v_pode := public.is_admin()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'acesso_total')
    OR NOT EXISTS (
      SELECT 1 FROM unnest(p_company_ids) x(id)
       WHERE NOT (
         EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = x.id
                   AND uc.role IN ('acesso_total','adm','admin','socio','financeiro'))
         OR EXISTS (SELECT 1 FROM user_scope us WHERE us.user_id = auth.uid() AND us.company_id = x.id AND us.papel_slug IN ('hub_socio','hub_financeiro'))
       )
    );

  SELECT jsonb_agg(d::date ORDER BY d) INTO v_meses
    FROM generate_series(v_ini, date_trunc('month',v_fim)::date, interval '1 month') d;
  SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome) ORDER BY codigo) INTO v_contas
    FROM psgc_contas WHERE codigo = ANY(p_psgc_codigos);

  -- total e por-mês direto do psgc_dre (mesma fonte das linhas do DRE) → reconciliação centavo a centavo
  SELECT round(COALESCE(sum(valor),0),2) INTO v_dre_total
    FROM psgc_dre WHERE company_id = ANY(p_company_ids) AND psgc_codigo = ANY(p_psgc_codigos)
      AND COALESCE(regime,'competencia') = v_regime
      AND make_date(ano,mes,1) BETWEEN v_ini AND date_trunc('month',v_fim)::date;
  SELECT COALESCE(jsonb_object_agg(to_char(make_date(ano,mes,1),'YYYY-MM-DD'), tot), '{}'::jsonb) INTO v_dre_por_mes
    FROM (SELECT ano, mes, round(sum(valor),2) AS tot FROM psgc_dre
          WHERE company_id = ANY(p_company_ids) AND psgc_codigo = ANY(p_psgc_codigos) AND COALESCE(regime,'competencia') = v_regime
            AND make_date(ano,mes,1) BETWEEN v_ini AND date_trunc('month',v_fim)::date GROUP BY ano, mes) q;

  IF NOT v_pode THEN
    RETURN jsonb_build_object('ok', true, 'pode_ver_pessoas', false, 'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
      'contas', COALESCE(v_contas,'[]'::jsonb), 'meses', COALESCE(v_meses,'[]'::jsonb),
      'total_dre', v_dre_total, 'dre_por_mes', v_dre_por_mes, 'pessoas', '[]'::jsonb,
      'motivo_sem_pessoas', 'Os nomes por pessoa (salários) são dados sensíveis — visíveis apenas para sócio, administrador e financeiro da empresa (LGPD).');
  END IF;

  WITH lanc AS (
    -- despesas (erp_pagar): pessoa = fornecedor; se vazio, nome extraído da descrição ("Salário Joseleno" → "Joseleno")
    SELECT COALESCE(
             NULLIF(btrim(p.fornecedor_nome),''),
             NULLIF(btrim(regexp_replace(COALESCE(p.descricao,''), '^\s*(sal[aá]rios?|pró[- ]?labore|pro[- ]?labore|adiantamento|pagamento)\s+', '', 'i')),''),
             '(sem nome)') AS pessoa,
           date_trunc('month', (CASE WHEN v_regime='caixa' THEN p.data_pagamento
                                     WHEN v_regime='previsto' THEN p.data_vencimento
                                     ELSE COALESCE(p.data_competencia, p.data_emissao) END))::date AS mes,
           COALESCE(p.valor,0) AS valor
    FROM erp_pagar p
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = ANY(p_psgc_codigos)
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND CASE WHEN v_regime='caixa'    THEN p.data_pagamento IS NOT NULL AND p.data_pagamento BETWEEN v_ini AND v_fim
               WHEN v_regime='previsto' THEN p.data_vencimento IS NOT NULL AND p.data_vencimento BETWEEN v_ini AND v_fim AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
               ELSE COALESCE(p.data_competencia, p.data_emissao) IS NOT NULL AND COALESCE(p.data_competencia, p.data_emissao) BETWEEN v_ini AND v_fim END
    UNION ALL
    -- receitas (erp_receber): pessoa = cliente
    SELECT COALESCE(
             NULLIF(btrim(r.cliente_nome),''),
             NULLIF(btrim(regexp_replace(COALESCE(r.descricao,''), '^\s*(recebimento|venda)\s+(de\s+)?', '', 'i')),''),
             '(sem nome)') AS pessoa,
           date_trunc('month', (CASE WHEN v_regime='caixa' THEN r.data_pagamento
                                     WHEN v_regime='previsto' THEN r.data_vencimento
                                     ELSE COALESCE(r.data_competencia, r.data_emissao) END))::date AS mes,
           COALESCE(r.valor,0) AS valor
    FROM erp_receber r
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = ANY(p_psgc_codigos)
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
      AND CASE WHEN v_regime='caixa'    THEN r.data_pagamento IS NOT NULL AND r.data_pagamento BETWEEN v_ini AND v_fim AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
               WHEN v_regime='previsto' THEN r.data_vencimento IS NOT NULL AND r.data_vencimento BETWEEN v_ini AND v_fim AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado','renegociado')
               ELSE COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL AND COALESCE(r.data_competencia, r.data_emissao) BETWEEN v_ini AND v_fim AND NOT COALESCE(r.eh_repasse_cartao,false) END
  ),
  por_pessoa AS (SELECT pessoa, sum(valor) AS total FROM lanc GROUP BY pessoa),
  rk AS (SELECT pessoa, row_number() OVER (ORDER BY total DESC, pessoa) AS rn FROM por_pessoa),
  rotulada AS (SELECT CASE WHEN rk.rn <= v_top THEN l.pessoa ELSE 'Outros' END AS pessoa, l.mes, l.valor FROM lanc l JOIN rk USING (pessoa)),
  agg AS (SELECT pessoa, mes, round(sum(valor),2) AS valor FROM rotulada GROUP BY pessoa, mes),
  dre_mes AS (SELECT make_date(ano,mes,1) AS mes, round(sum(valor),2) AS valor FROM psgc_dre
              WHERE company_id = ANY(p_company_ids) AND psgc_codigo = ANY(p_psgc_codigos) AND COALESCE(regime,'competencia') = v_regime
                AND make_date(ano,mes,1) BETWEEN v_ini AND date_trunc('month',v_fim)::date GROUP BY 1),
  pess_mes AS (SELECT mes, sum(valor) AS valor FROM agg GROUP BY mes),
  nao_ident AS (SELECT d.mes, round(COALESCE(d.valor,0) - COALESCE(pm.valor,0),2) AS valor
                FROM dre_mes d LEFT JOIN pess_mes pm USING (mes)
                WHERE round(COALESCE(d.valor,0) - COALESCE(pm.valor,0),2) <> 0),
  todos AS (SELECT pessoa, mes, valor FROM agg UNION ALL SELECT 'Não identificado', mes, valor FROM nao_ident)
  SELECT jsonb_agg(x ORDER BY (x->>'total')::numeric DESC) INTO v_pessoas FROM (
    SELECT jsonb_build_object('pessoa', pessoa, 'total', round(sum(valor),2),
             'por_mes', jsonb_object_agg(to_char(mes,'YYYY-MM-DD'), valor)) AS x
    FROM todos GROUP BY pessoa
  ) z;

  RETURN jsonb_build_object('ok', true, 'pode_ver_pessoas', true, 'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'contas', COALESCE(v_contas,'[]'::jsonb), 'meses', COALESCE(v_meses,'[]'::jsonb),
    'total_dre', v_dre_total, 'dre_por_mes', v_dre_por_mes, 'pessoas', COALESCE(v_pessoas,'[]'::jsonb), 'top', v_top);
END $function$;

-- fn_psgc_dre_conciliacao(uuid[],date,date,text)
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_conciliacao(p_company_ids uuid[], p_mes_ini date, p_mes_fim date, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regime text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini    date := date_trunc('month', p_mes_ini)::date;
  v_fim    date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_contas jsonb; v_resumo jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  WITH tit AS (
    -- A PAGAR: cada título vai para a sua melhor conta de-para que NÃO é de receita; valor com o sinal da linha.
    SELECT best.psgc_codigo, pc.dre_grupo AS grupo,
           (CASE WHEN pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP') THEN 1 ELSE -1 END) * COALESCE(p.valor,0) AS valor_exibido
    FROM erp_pagar p
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc2 ON pc2.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc2.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    JOIN psgc_contas pc ON pc.codigo = best.psgc_codigo
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND CASE
        WHEN v_regime='caixa'    THEN p.data_pagamento IS NOT NULL AND p.data_pagamento BETWEEN v_ini AND v_fim
        WHEN v_regime='previsto' THEN p.data_vencimento IS NOT NULL AND p.data_vencimento BETWEEN v_ini AND v_fim
                                      AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
        ELSE COALESCE(p.data_competencia, p.data_emissao) IS NOT NULL
             AND COALESCE(p.data_competencia, p.data_emissao) BETWEEN v_ini AND v_fim
      END
    UNION ALL
    -- A RECEBER: melhor conta de-para de receita/não-operacional/financeiro; recebimento em conta mista entra negativo.
    SELECT best.psgc_codigo, pc.dre_grupo,
           (CASE WHEN pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP') THEN 1 ELSE -1 END)
           * (CASE WHEN pc.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END) * COALESCE(r.valor,0) AS valor_exibido
    FROM erp_receber r
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc2 ON pc2.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc2.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    JOIN psgc_contas pc ON pc.codigo = best.psgc_codigo
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL
      AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
      AND CASE
        WHEN v_regime='caixa'    THEN r.data_pagamento IS NOT NULL AND r.data_pagamento BETWEEN v_ini AND v_fim
                                      AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
        WHEN v_regime='previsto' THEN r.data_vencimento IS NOT NULL AND r.data_vencimento BETWEEN v_ini AND v_fim
                                      AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado','renegociado')
        ELSE COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL
             AND COALESCE(r.data_competencia, r.data_emissao) BETWEEN v_ini AND v_fim
             AND NOT COALESCE(r.eh_repasse_cartao,false)
      END
  ),
  det AS (
    SELECT psgc_codigo, round(SUM(valor_exibido),2) AS total_detalhe FROM tit GROUP BY psgc_codigo
  ),
  dre AS (
    SELECT d.psgc_codigo,
      round((CASE WHEN pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP') THEN 1 ELSE -1 END)
        * SUM(CASE WHEN d.source ILIKE '%receber%' AND pc.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -d.valor ELSE d.valor END),2) AS dre_periodo
    FROM psgc_dre d JOIN psgc_contas pc ON pc.codigo = d.psgc_codigo
    WHERE d.company_id = ANY(p_company_ids) AND COALESCE(d.regime,'competencia') = v_regime
      AND make_date(d.ano, d.mes, 1) BETWEEN v_ini AND date_trunc('month', v_fim)::date
    GROUP BY d.psgc_codigo, pc.dre_grupo
  ),
  linhas AS (
    SELECT COALESCE(dre.psgc_codigo, det.psgc_codigo) AS codigo,
           pc.nome AS conta_nome, pc.dre_grupo AS grupo,
           COALESCE(pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP'), false) AS is_receita,
           round(COALESCE(det.total_detalhe,0),2) AS total_detalhe,
           round(COALESCE(dre.dre_periodo,0),2)  AS dre_periodo,
           round(COALESCE(det.total_detalhe,0) - COALESCE(dre.dre_periodo,0),2) AS diferenca
    FROM dre FULL JOIN det ON det.psgc_codigo = dre.psgc_codigo
    LEFT JOIN psgc_contas pc ON pc.codigo = COALESCE(dre.psgc_codigo, det.psgc_codigo)
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'codigo', codigo, 'conta_nome', conta_nome, 'grupo', grupo, 'is_receita', is_receita,
      'total_detalhe', total_detalhe, 'dre_periodo', dre_periodo, 'diferenca', diferenca,
      'concilia', (abs(diferenca) < 0.01)
    ) ORDER BY codigo),
    jsonb_build_object(
      'n_contas', count(*),
      'n_conciliam', count(*) FILTER (WHERE abs(diferenca) < 0.01),
      'n_diferem', count(*) FILTER (WHERE abs(diferenca) >= 0.01),
      'maior_diff_abs', COALESCE(max(abs(diferenca)),0),
      'soma_diff_abs', COALESCE(round(sum(abs(diferenca)),2),0)
    )
  INTO v_contas, v_resumo FROM linhas;

  RETURN jsonb_build_object(
    'ok', true, 'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'contas', COALESCE(v_contas, '[]'::jsonb), 'resumo', v_resumo
  );
END $function$;

-- fn_psgc_dre_diario(uuid[],text,integer,integer,text)
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_diario(p_company_ids uuid[], p_psgc_codigo text, p_ano integer, p_mes integer, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regime    text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini       date := make_date(p_ano, p_mes, 1);
  v_fim       date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_natureza  text; v_dre_grupo text; v_is_receita boolean;
  v_out jsonb; v_total numeric; v_dre_mes numeric;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  IF p_psgc_codigo = 'PREV_SC_ENT' THEN v_is_receita := true;
  ELSIF p_psgc_codigo = 'PREV_SC_SAI' THEN v_is_receita := false;
  ELSE
    SELECT natureza, dre_grupo INTO v_natureza, v_dre_grupo FROM psgc_contas WHERE codigo = p_psgc_codigo;
    v_is_receita := COALESCE(v_dre_grupo IN ('ROB','RECEITAS_NAO_OP'), false) OR v_natureza = 'receita';
  END IF;

  IF v_regime = 'previsto' THEN
    IF v_is_receita THEN
      WITH tit AS (
        SELECT r.cliente_id AS pid,
               COALESCE(NULLIF(btrim(r.cliente_nome),''), '(sem nome)')
                 || CASE WHEN p_psgc_codigo='PREV_SC_ENT' THEN ' · cat: ' || COALESCE(NULLIF(btrim(r.categoria),''),'—') ELSE '' END AS pnome,
               r.data_vencimento::date AS dia, COALESCE(r.valor,0) AS valor
        FROM erp_receber r
        LEFT JOIN LATERAL (
          SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
          WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
            AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
          ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
        ) best ON true
        WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND r.data_vencimento IS NOT NULL
          AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado','renegociado')
          AND r.data_vencimento::date BETWEEN v_ini AND v_fim
          AND ( (p_psgc_codigo = 'PREV_SC_ENT' AND best.psgc_codigo IS NULL)
                OR (p_psgc_codigo <> 'PREV_SC_ENT' AND best.psgc_codigo = p_psgc_codigo) )
      ),
      perday AS (SELECT pid, pnome, to_char(dia,'YYYY-MM-DD') ymd, SUM(valor) v FROM tit GROUP BY pid, pnome, to_char(dia,'YYYY-MM-DD')),
      agg AS (SELECT pid, max(pnome) pnome, jsonb_object_agg(ymd, round(v,2)) valores_dia, SUM(v) total FROM perday GROUP BY pid)
      SELECT jsonb_agg(jsonb_build_object('pessoa_id', pid, 'pessoa_nome', pnome, 'valores_dia', valores_dia, 'total', round(total,2)) ORDER BY total DESC),
             round(COALESCE(SUM(total),0),2)
        INTO v_out, v_total FROM agg;
    ELSE
      WITH tit AS (
        SELECT p.fornecedor_id AS pid,
               COALESCE(NULLIF(btrim(p.fornecedor_nome),''), '(sem nome)')
                 || CASE WHEN p_psgc_codigo='PREV_SC_SAI' THEN ' · cat: ' || COALESCE(NULLIF(btrim(p.categoria),''),'—') ELSE '' END AS pnome,
               p.data_vencimento::date AS dia, COALESCE(p.valor,0) AS valor
        FROM erp_pagar p
        LEFT JOIN LATERAL (
          SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
          WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
            AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
          ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
        ) best ON true
        WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL AND p.data_vencimento IS NOT NULL
          AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
          AND p.data_vencimento::date BETWEEN v_ini AND v_fim
          AND ( (p_psgc_codigo = 'PREV_SC_SAI' AND best.psgc_codigo IS NULL)
                OR (p_psgc_codigo <> 'PREV_SC_SAI' AND best.psgc_codigo = p_psgc_codigo) )
      ),
      perday AS (SELECT pid, pnome, to_char(dia,'YYYY-MM-DD') ymd, SUM(valor) v FROM tit GROUP BY pid, pnome, to_char(dia,'YYYY-MM-DD')),
      agg AS (SELECT pid, max(pnome) pnome, jsonb_object_agg(ymd, round(v,2)) valores_dia, SUM(v) total FROM perday GROUP BY pid)
      SELECT jsonb_agg(jsonb_build_object('pessoa_id', pid, 'pessoa_nome', pnome, 'valores_dia', valores_dia, 'total', round(total,2)) ORDER BY total DESC),
             round(COALESCE(SUM(total),0),2)
        INTO v_out, v_total FROM agg;
    END IF;
    v_dre_mes := NULL;
  ELSE
    IF v_is_receita THEN
      WITH tit AS (
        SELECT r.cliente_id AS pid,
               COALESCE(NULLIF(btrim(r.cliente_nome),''), '(sem nome)') AS pnome,
               (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) AS dia,
               COALESCE(r.valor,0) AS valor
        FROM erp_receber r
        JOIN LATERAL (
          SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
          WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
            AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
          ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
        ) best ON best.psgc_codigo = p_psgc_codigo
        WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL
          AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
          AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento ELSE r.data_emissao::timestamptz END) IS NOT NULL
          AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim AND (CASE WHEN v_regime='caixa' THEN COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito') ELSE NOT COALESCE(r.eh_repasse_cartao,false) END)
      ),
      perday AS (SELECT pid, pnome, to_char(dia,'YYYY-MM-DD') ymd, SUM(valor) v FROM tit GROUP BY pid, pnome, to_char(dia,'YYYY-MM-DD')),
      agg AS (SELECT pid, max(pnome) pnome, jsonb_object_agg(ymd, round(v,2)) valores_dia, SUM(v) total FROM perday GROUP BY pid)
      SELECT jsonb_agg(jsonb_build_object('pessoa_id', pid, 'pessoa_nome', pnome, 'valores_dia', valores_dia, 'total', round(total,2)) ORDER BY total DESC),
             round(COALESCE(SUM(total),0),2)
        INTO v_out, v_total FROM agg;
    ELSE
      WITH tit AS (
        SELECT p.fornecedor_id AS pid,
               COALESCE(NULLIF(btrim(p.fornecedor_nome),''), '(sem nome)') AS pnome,
               (CASE WHEN v_regime='caixa' THEN p.data_pagamento::date ELSE p.data_emissao::date END) AS dia,
               COALESCE(p.valor,0) AS valor
        FROM erp_pagar p
        JOIN LATERAL (
          SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
          WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
            AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
          ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
        ) best ON best.psgc_codigo = p_psgc_codigo
        WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
          AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
          AND (CASE WHEN v_regime='caixa' THEN p.data_pagamento ELSE p.data_emissao END) IS NOT NULL
          AND (CASE WHEN v_regime='caixa' THEN p.data_pagamento::date ELSE p.data_emissao::date END) BETWEEN v_ini AND v_fim
      ),
      perday AS (SELECT pid, pnome, to_char(dia,'YYYY-MM-DD') ymd, SUM(valor) v FROM tit GROUP BY pid, pnome, to_char(dia,'YYYY-MM-DD')),
      agg AS (SELECT pid, max(pnome) pnome, jsonb_object_agg(ymd, round(v,2)) valores_dia, SUM(v) total FROM perday GROUP BY pid)
      SELECT jsonb_agg(jsonb_build_object('pessoa_id', pid, 'pessoa_nome', pnome, 'valores_dia', valores_dia, 'total', round(total,2)) ORDER BY total DESC),
             round(COALESCE(SUM(total),0),2)
        INTO v_out, v_total FROM agg;
    END IF;

    SELECT round(COALESCE(SUM(valor),0),2) INTO v_dre_mes FROM psgc_dre
    WHERE company_id = ANY(p_company_ids) AND psgc_codigo = p_psgc_codigo
      AND ano = p_ano AND mes = p_mes AND COALESCE(regime,'competencia') = v_regime;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'psgc_codigo', p_psgc_codigo, 'is_receita', v_is_receita,
    'fonte', CASE WHEN v_is_receita THEN 'erp_receber' ELSE 'erp_pagar' END,
    'ano', p_ano, 'mes', p_mes, 'regime', v_regime,
    'dias_no_mes', extract(day FROM v_fim)::int,
    'dre_mes', v_dre_mes, 'total', COALESCE(v_total,0),
    'pessoas', COALESCE(v_out, '[]'::jsonb)
  );
END $function$;

-- fn_psgc_dre_horizontal_dia(uuid[],integer,integer,text)
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_horizontal_dia(p_company_ids uuid[], p_ano integer, p_mes integer, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regime   text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini      date := make_date(p_ano, p_mes, 1);
  v_fim      date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_empresas int  := 0;
  v_dias     jsonb;
  v_linhas   jsonb;
  v_saldo_ini numeric := 0;
  v_dia_neg   text;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada'); END IF;
  IF p_ano < 2024 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Período anterior a 2024 não disponível'); END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo'); END IF;

  SELECT jsonb_agg(jsonb_build_object('d', d, 'ymd', to_char(make_date(p_ano,p_mes,d),'YYYY-MM-DD')) ORDER BY d)
    INTO v_dias FROM generate_series(1, extract(day FROM v_fim)::int) d;

  IF v_regime = 'previsto' THEN
    v_saldo_ini := COALESCE(public.fn_saldo_bancos_dinamico(p_company_ids), 0);

    SELECT count(*) INTO v_empresas FROM (
      SELECT company_id FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento IS NOT NULL
        AND lower(COALESCE(status,'')) NOT IN ('pago','recebido','cancelado','renegociado') AND data_vencimento::date BETWEEN v_ini AND v_fim
      UNION
      SELECT company_id FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento IS NOT NULL
        AND lower(COALESCE(status,'')) NOT IN ('pago','cancelado') AND data_vencimento::date BETWEEN v_ini AND v_fim
    ) e;

    WITH ent AS (
      SELECT best.psgc_codigo AS codigo, r.data_vencimento::date AS dia, COALESCE(r.valor,0) AS valor
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON true
      WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND r.data_vencimento IS NOT NULL
        AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado','renegociado')
        AND r.data_vencimento::date BETWEEN v_ini AND v_fim
    ),
    sai AS (
      SELECT best.psgc_codigo AS codigo, p.data_vencimento::date AS dia, COALESCE(p.valor,0) AS valor
      FROM erp_pagar p
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON true
      WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL AND p.data_vencimento IS NOT NULL
        AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
        AND p.data_vencimento::date BETWEEN v_ini AND v_fim
    ),
    ent_cd AS (SELECT COALESCE(codigo,'PREV_SC_ENT') AS codigo, to_char(dia,'YYYY-MM-DD') AS ymd, SUM(valor) AS v FROM ent GROUP BY 1,2),
    sai_cd AS (SELECT COALESCE(codigo,'PREV_SC_SAI') AS codigo, to_char(dia,'YYYY-MM-DD') AS ymd, SUM(valor) AS v FROM sai GROUP BY 1,2),
    dd AS (SELECT to_char(make_date(p_ano,p_mes,d),'YYYY-MM-DD') AS ymd, d FROM generate_series(1, extract(day FROM v_fim)::int) d),
    day_tot AS (
      SELECT dd.ymd, dd.d,
        COALESCE((SELECT SUM(v) FROM ent_cd WHERE ent_cd.ymd = dd.ymd),0) AS ent,
        COALESCE((SELECT SUM(v) FROM sai_cd WHERE sai_cd.ymd = dd.ymd),0) AS sai
      FROM dd
    ),
    acc AS (SELECT ymd, d, ent, sai, (ent - sai) AS mov, v_saldo_ini + SUM(ent - sai) OVER (ORDER BY d) AS saldo FROM day_tot),
    ent_contas AS (
      SELECT ec.codigo, COALESCE(c.nome,'Sem classificação') AS nome,
        (CASE WHEN ec.codigo='PREV_SC_ENT' THEN 1000.999 ELSE 1000 + COALESCE(c.dre_ordem,900)*0.001 END) AS ordem,
        jsonb_object_agg(ec.ymd, round(ec.v,2)) AS valores_dia
      FROM ent_cd ec LEFT JOIN psgc_contas c ON c.codigo = ec.codigo
      GROUP BY ec.codigo, c.nome, c.dre_ordem
    ),
    sai_contas AS (
      SELECT sc.codigo, COALESCE(c.nome,'Sem classificação') AS nome,
        (CASE WHEN sc.codigo='PREV_SC_SAI' THEN 2000.999 ELSE 2000 + COALESCE(c.dre_ordem,900)*0.001 END) AS ordem,
        jsonb_object_agg(sc.ymd, round(sc.v,2)) AS valores_dia
      FROM sai_cd sc LEFT JOIN psgc_contas c ON c.codigo = sc.codigo
      GROUP BY sc.codigo, c.nome, c.dre_ordem
    ),
    linhas AS (
      SELECT 1000::numeric AS ordem, jsonb_build_object('ordem',1000,'kind','grupo','codigo','PREV_ENT','nome','Entradas previstas','grupo_ref','PREV_ENT','sinal','+','nivel',0,'colapsavel',true,
        'valores_dia',COALESCE((SELECT jsonb_object_agg(ymd, round(v,2)) FROM (SELECT ymd, SUM(v) v FROM ent_cd GROUP BY ymd) z),'{}'::jsonb)) AS l
      UNION ALL
      SELECT ordem, jsonb_build_object('ordem',ordem,'kind','conta','codigo',codigo,'nome',nome,'grupo_ref','PREV_ENT','sinal','+','nivel',1,'colapsavel',false,'valores_dia',valores_dia) FROM ent_contas
      UNION ALL
      SELECT 2000::numeric, jsonb_build_object('ordem',2000,'kind','grupo','codigo','PREV_SAI','nome','Saídas previstas','grupo_ref','PREV_SAI','sinal','-','nivel',0,'colapsavel',true,
        'valores_dia',COALESCE((SELECT jsonb_object_agg(ymd, round(v,2)) FROM (SELECT ymd, SUM(v) v FROM sai_cd GROUP BY ymd) z),'{}'::jsonb))
      UNION ALL
      SELECT ordem, jsonb_build_object('ordem',ordem,'kind','conta','codigo',codigo,'nome',nome,'grupo_ref','PREV_SAI','sinal','-','nivel',1,'colapsavel',false,'valores_dia',valores_dia) FROM sai_contas
      UNION ALL
      SELECT 3000::numeric, jsonb_build_object('ordem',3000,'kind','resultado','codigo','MOVIMENTO','nome','Movimento do dia','sinal','±','nivel',0,'colapsavel',false,
        'valores_dia',(SELECT jsonb_object_agg(ymd, round(mov,2)) FROM acc))
      UNION ALL
      SELECT 4000::numeric, jsonb_build_object('ordem',4000,'kind','resultado','codigo','SALDO','nome','Saldo acumulado projetado','sinal','=','nivel',0,'colapsavel',false,
        'valores_dia',(SELECT jsonb_object_agg(ymd, round(saldo,2)) FROM acc))
    )
    SELECT jsonb_agg(l ORDER BY ordem), (SELECT min(ymd) FROM acc WHERE saldo < 0)
      INTO v_linhas, v_dia_neg FROM linhas;

    RETURN jsonb_build_object(
      'ok', true, 'regime', 'previsto', 'empresas', v_empresas,
      'ano', p_ano, 'mes', p_mes, 'dias_no_mes', extract(day FROM v_fim)::int,
      'dias', COALESCE(v_dias, '[]'::jsonb), 'linhas', COALESCE(v_linhas, '[]'::jsonb),
      'saldo_inicial', round(v_saldo_ini, 2), 'dia_negativo', v_dia_neg
    );
  END IF;

  WITH raw AS (
    SELECT COALESCE(best.psgc_codigo, '1.4') AS psgc_codigo,
           (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) AS dia,
           CASE WHEN COALESCE(best.psgc_codigo, '1.4') IN (SELECT codigo FROM psgc_contas WHERE dre_grupo IN ('NAO_OPER','RESULT_FIN')) THEN -COALESCE(r.valor,0) ELSE COALESCE(r.valor,0) END AS valor, r.company_id
    FROM erp_receber r
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
      AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim AND (CASE WHEN v_regime='caixa' THEN COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito') ELSE NOT COALESCE(r.eh_repasse_cartao,false) END)
    UNION ALL
    SELECT COALESCE(best.psgc_codigo, '6.11') AS psgc_codigo, v.data_emissao AS dia,
           COALESCE(v.valor_distribuido,0) AS valor, v.company_id
    FROM v_psgc_pagar_distribuido v
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = v.company_id AND pd.origem_codigo = v.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE v_regime = 'competencia' AND v.company_id = ANY(p_company_ids)
      AND (v.status IS NULL OR v.status NOT IN ('cancelado','CANCELADO'))
      AND v.data_emissao BETWEEN v_ini AND v_fim
    UNION ALL
    SELECT COALESCE(best.psgc_codigo, '6.11') AS psgc_codigo, p.data_pagamento::date AS dia,
           COALESCE(p.valor,0) AS valor, p.company_id
    FROM erp_pagar p
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE v_regime = 'caixa' AND p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND p.data_pagamento::date BETWEEN v_ini AND v_fim
  ),
  gmap(dre_grupo, header_ordem, sinal, nome, signo) AS (VALUES
    ('ROB',1000,'+','Receita Operacional Bruta',1),('DEDUCOES',2000,'-','(−) Deduções',-1),
    ('IMPOSTOS_VENDA',2100,'-','(−) Impostos sobre Vendas',-1),('CMV',3100,'-','(−) CMV / CPV / CSP',-1),
    ('DESP_VARIAVEL',4100,'-','(−) Despesas Variáveis',-1),('DESP_FIXA',5100,'-','(−) Despesas Fixas',-1),
    ('DEPREC_AMORT',6100,'-','(−) Depreciação e Amortização',-1),('RESULT_FIN',7100,'±','(±) Resultado Financeiro',-1),
    ('NAO_OPER',7200,'±','(±) Resultado Não-Operacional',-1),('IR_CSLL',8100,'-','(−) IR e CSLL',-1),
    ('DESTINACAO',9500,'-','Destinação do Lucro',-1)
  ),
  conta_dia AS (
    SELECT r.psgc_codigo, c.dre_grupo, to_char(r.dia,'YYYY-MM-DD') AS ymd, SUM(r.valor) AS v
    FROM raw r JOIN psgc_contas c ON c.codigo = r.psgc_codigo
    WHERE c.dre_grupo <> 'NEUTRO' AND r.dia IS NOT NULL GROUP BY r.psgc_codigo, c.dre_grupo, to_char(r.dia,'YYYY-MM-DD')
  ),
  grp_dia AS (SELECT dre_grupo, ymd, SUM(v) AS v FROM conta_dia GROUP BY dre_grupo, ymd),
  pivot AS (
    SELECT ymd,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='ROB'),0) AS rob,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEDUCOES'),0) AS deducoes,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IMPOSTOS_VENDA'),0) AS impostos,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='CMV'),0) AS cmv,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_VARIAVEL'),0) AS desp_var,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESP_FIXA'),0) AS desp_fixa,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DEPREC_AMORT'),0) AS deprec,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='RESULT_FIN'),0) AS result_fin,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='NAO_OPER'),0) AS nao_oper,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IR_CSLL'),0) AS ir_csll,
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='DESTINACAO'),0) AS destinacao
    FROM grp_dia GROUP BY ymd
  ),
  res AS (
    SELECT ymd,
      (rob-deducoes-impostos) AS rl, (rob-deducoes-impostos-cmv) AS mb,
      (rob-deducoes-impostos-cmv-desp_var) AS mc, (rob-deducoes-impostos-cmv-desp_var-desp_fixa) AS ebitda,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec) AS ebit,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper) AS rai,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper-ir_csll) AS ll,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper-ir_csll-destinacao) AS lrt
    FROM pivot
  ),
  res_lines(ordem, codigo, nome) AS (VALUES
    (3000,'RL','= Receita Líquida'),(4000,'MB','= Margem Bruta'),(5000,'MC','= Margem de Contribuição'),
    (6000,'EBITDA','= EBITDA'),(7000,'EBIT','= EBIT (Resultado Operacional)'),
    (8000,'RAI','= Resultado antes do IR/CSLL'),(9000,'LL','= Lucro Líquido'),
    (9900,'LRT','= Lucro Líquido Retido')
  ),
  linhas AS (
    SELECT gm.header_ordem::numeric AS ordem, 'grupo' AS kind, gm.dre_grupo AS codigo, gm.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 0 AS nivel, true AS colapsavel,
           NULL::boolean AS mb, NULL::boolean AS mc, NULL::boolean AS eb,
           jsonb_object_agg(g.ymd, round(gm.signo * g.v, 2)) AS valores_dia
    FROM gmap gm JOIN grp_dia g ON g.dre_grupo = gm.dre_grupo
    GROUP BY gm.header_ordem, gm.dre_grupo, gm.nome, gm.sinal
    UNION ALL
    SELECT (gm.header_ordem + c.dre_ordem * 0.001)::numeric AS ordem, 'conta' AS kind, c.codigo, c.nome,
           gm.dre_grupo AS grupo_ref, gm.sinal, 1 AS nivel, false AS colapsavel,
           c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda,
           jsonb_object_agg(cd.ymd, round(gm.signo * cd.v, 2)) AS valores_dia
    FROM conta_dia cd JOIN psgc_contas c ON c.codigo = cd.psgc_codigo JOIN gmap gm ON gm.dre_grupo = c.dre_grupo
    GROUP BY c.codigo, c.nome, c.dre_ordem, gm.header_ordem, gm.dre_grupo, gm.sinal,
             c.afeta_margem_bruta, c.afeta_margem_contribuicao, c.afeta_ebitda
    UNION ALL
    SELECT rl.ordem::numeric, 'resultado', rl.codigo, rl.nome, NULL, '=', 0, false,
           NULL::boolean, NULL::boolean, NULL::boolean,
           jsonb_object_agg(r.ymd, round(
             CASE rl.codigo WHEN 'RL' THEN r.rl WHEN 'MB' THEN r.mb WHEN 'MC' THEN r.mc
               WHEN 'EBITDA' THEN r.ebitda WHEN 'EBIT' THEN r.ebit WHEN 'RAI' THEN r.rai
               WHEN 'LL' THEN r.ll WHEN 'LRT' THEN r.lrt END, 2))
    FROM res_lines rl CROSS JOIN res r GROUP BY rl.ordem, rl.codigo, rl.nome
  )
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'ordem', ordem, 'kind', kind, 'codigo', codigo, 'nome', nome,
           'grupo_ref', grupo_ref, 'sinal', sinal, 'nivel', nivel, 'colapsavel', colapsavel,
           'afeta_margem_bruta', mb, 'afeta_margem_contribuicao', mc, 'afeta_ebitda', eb,
           'valores_dia', valores_dia
         )) ORDER BY ordem)
    INTO v_linhas FROM linhas;

  SELECT count(DISTINCT company_id) INTO v_empresas FROM (
    SELECT company_id FROM erp_receber WHERE company_id = ANY(p_company_ids)
      AND (CASE WHEN v_regime='caixa' THEN data_pagamento::date ELSE data_emissao::date END) BETWEEN v_ini AND v_fim
    UNION
    SELECT company_id FROM erp_pagar WHERE company_id = ANY(p_company_ids)
      AND (CASE WHEN v_regime='caixa' THEN data_pagamento::date ELSE data_emissao::date END) BETWEEN v_ini AND v_fim
  ) e;

  RETURN jsonb_build_object(
    'ok', true, 'regime', v_regime, 'empresas', v_empresas,
    'ano', p_ano, 'mes', p_mes, 'dias_no_mes', extract(day FROM v_fim)::int,
    'dias', COALESCE(v_dias, '[]'::jsonb), 'linhas', COALESCE(v_linhas, '[]'::jsonb)
  );
END $function$;

-- fn_psgc_dre_lancamentos(uuid[],text,date,date,text)
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_lancamentos(p_company_ids uuid[], p_psgc_codigo text, p_mes_ini date, p_mes_fim date, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regime     text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini        date := date_trunc('month', p_mes_ini)::date;
  v_fim        date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_grupo      text; v_conta_nome text; v_is_receita boolean; v_signo int;
  v_lanc jsonb; v_orfaos jsonb; v_total numeric; v_dre_periodo numeric;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  SELECT nome, dre_grupo INTO v_conta_nome, v_grupo FROM psgc_contas WHERE codigo = p_psgc_codigo;
  v_is_receita := COALESCE(v_grupo IN ('ROB','RECEITAS_NAO_OP'), false);
  -- signo da linha no DRE: receita (+), todo o resto (−) — espelha a gmap da fn_psgc_dre_horizontal
  v_signo := CASE WHEN v_is_receita THEN 1 ELSE -1 END;

  WITH tit AS (
    -- A PAGAR (todo grupo que não é de receita)
    SELECT 'a pagar'::text AS origem, p.id, p.company_id,
           COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(p.descricao),'') AS descricao, NULLIF(btrim(p.numero_documento),'') AS documento,
           p.data_competencia, p.data_vencimento, p.data_pagamento, COALESCE(p.valor,0) AS valor, p.status,
           (CASE WHEN v_regime='caixa' THEN p.data_pagamento
                 WHEN v_regime='previsto' THEN p.data_vencimento
                 ELSE COALESCE(p.data_competencia, p.data_emissao) END)::date AS data_regime,
           v_signo * COALESCE(p.valor,0) AS valor_exibido
    FROM erp_pagar p
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = p_psgc_codigo
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND CASE
        WHEN v_regime='caixa'    THEN p.data_pagamento IS NOT NULL AND p.data_pagamento BETWEEN v_ini AND v_fim
        WHEN v_regime='previsto' THEN p.data_vencimento IS NOT NULL AND p.data_vencimento BETWEEN v_ini AND v_fim
                                      AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
        ELSE COALESCE(p.data_competencia, p.data_emissao) IS NOT NULL
             AND COALESCE(p.data_competencia, p.data_emissao) BETWEEN v_ini AND v_fim
      END
    UNION ALL
    -- A RECEBER (grupos de receita + não-operacional/financeiro, onde há recebimento)
    SELECT 'a receber'::text AS origem, r.id, r.company_id,
           COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(r.descricao),'') AS descricao, NULLIF(btrim(r.numero_documento),'') AS documento,
           r.data_competencia, r.data_vencimento, r.data_pagamento, COALESCE(r.valor,0) AS valor, r.status,
           (CASE WHEN v_regime='caixa' THEN r.data_pagamento
                 WHEN v_regime='previsto' THEN r.data_vencimento
                 ELSE COALESCE(r.data_competencia, r.data_emissao) END)::date AS data_regime,
           v_signo * (CASE WHEN v_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END) * COALESCE(r.valor,0) AS valor_exibido
    FROM erp_receber r
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = p_psgc_codigo
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL
      AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
      AND CASE
        WHEN v_regime='caixa'    THEN r.data_pagamento IS NOT NULL AND r.data_pagamento BETWEEN v_ini AND v_fim
                                      AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
        WHEN v_regime='previsto' THEN r.data_vencimento IS NOT NULL AND r.data_vencimento BETWEEN v_ini AND v_fim
                                      AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado','renegociado')
        ELSE COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL
             AND COALESCE(r.data_competencia, r.data_emissao) BETWEEN v_ini AND v_fim
             AND NOT COALESCE(r.eh_repasse_cartao,false)
      END
  )
  SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'empresa_id', company_id, 'origem', origem, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
           'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
           'valor', round(valor,2), 'valor_exibido', round(valor_exibido,2), 'status', status, 'sem_competencia', (data_competencia IS NULL)
         ) ORDER BY data_regime, valor_exibido),
         round(COALESCE(SUM(valor_exibido),0),2)
    INTO v_lanc, v_total FROM tit;

  -- órfãos: títulos da conta (dos dois lados) sem competência e sem emissão, que caem no período por vencimento/pagamento
  WITH orf AS (
    SELECT 'a pagar'::text AS origem, p.id, p.company_id, COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(p.descricao),'') AS descricao, NULLIF(btrim(p.numero_documento),'') AS documento,
           p.data_competencia, p.data_vencimento, p.data_pagamento, COALESCE(p.valor,0) AS valor, p.status,
           v_signo * COALESCE(p.valor,0) AS valor_exibido, COALESCE(p.data_vencimento, p.data_pagamento) AS ord
    FROM erp_pagar p
    JOIN LATERAL (SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1) best ON best.psgc_codigo = p_psgc_codigo
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND COALESCE(p.data_competencia, p.data_emissao) IS NULL AND COALESCE(p.data_vencimento, p.data_pagamento) BETWEEN v_ini AND v_fim
    UNION ALL
    SELECT 'a receber'::text AS origem, r.id, r.company_id, COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(r.descricao),'') AS descricao, NULLIF(btrim(r.numero_documento),'') AS documento,
           r.data_competencia, r.data_vencimento, r.data_pagamento, COALESCE(r.valor,0) AS valor, r.status,
           v_signo * (CASE WHEN v_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END) * COALESCE(r.valor,0) AS valor_exibido,
           COALESCE(r.data_vencimento, r.data_pagamento) AS ord
    FROM erp_receber r
    JOIN LATERAL (SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1) best ON best.psgc_codigo = p_psgc_codigo
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND (r.status IS NULL OR r.status NOT IN ('cancelado','renegociado'))
      AND COALESCE(r.data_competencia, r.data_emissao) IS NULL AND COALESCE(r.data_vencimento, r.data_pagamento) BETWEEN v_ini AND v_fim
  )
  SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'empresa_id', company_id, 'origem', origem, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
           'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
           'valor', round(valor,2), 'valor_exibido', round(valor_exibido,2), 'status', status, 'sem_competencia', true
         ) ORDER BY ord) INTO v_orfaos FROM orf;

  -- valor da linha no período COM SINAL, da mesma forma que a fn_psgc_dre_horizontal (reconciliação com o DRE)
  SELECT round(v_signo * COALESCE(SUM(CASE WHEN d.source ILIKE '%receber%' AND v_grupo IN ('NAO_OPER','RESULT_FIN') THEN -d.valor ELSE d.valor END),0),2)
    INTO v_dre_periodo
  FROM psgc_dre d
  WHERE d.company_id = ANY(p_company_ids) AND d.psgc_codigo = p_psgc_codigo
    AND COALESCE(d.regime,'competencia') = v_regime
    AND make_date(d.ano, d.mes, 1) BETWEEN v_ini AND date_trunc('month', v_fim)::date;

  RETURN jsonb_build_object(
    'ok', true,
    'conta_codigo', p_psgc_codigo, 'conta_nome', v_conta_nome, 'dre_grupo', v_grupo,
    'is_receita', v_is_receita, 'fonte', 'erp_pagar + erp_receber',
    'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'total', COALESCE(v_total,0), 'dre_periodo', v_dre_periodo,
    'diferenca', round(COALESCE(v_total,0) - COALESCE(v_dre_periodo,0),2),
    'lancamentos', COALESCE(v_lanc, '[]'::jsonb),
    'orfaos', COALESCE(v_orfaos, '[]'::jsonb)
  );
END $function$;

-- fn_truth_audit_dre()
CREATE OR REPLACE FUNCTION public.fn_truth_audit_dre()
 RETURNS TABLE(alertas_gerados integer, empresas_auditadas integer, divergencias_criticas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_alertas INT := 0; v_empresas INT := 0; v_criticas INT := 0;
BEGIN
  DELETE FROM erp_truth_alerts WHERE rule_id = 'dre_receita_bate_nfs' AND status IN ('novo','ignorado');
  WITH receita_real AS (
    SELECT r.company_id, EXTRACT(YEAR FROM r.data_emissao)::int AS ano, EXTRACT(MONTH FROM r.data_emissao)::int AS mes, SUM(r.valor) AS valor_real
    FROM erp_receber r WHERE r.valor > 0 AND r.data_emissao IS NOT NULL AND NOT COALESCE(r.eh_repasse_cartao,false) AND (r.status IS NULL OR r.status <> 'renegociado')
      AND r.company_id IN (SELECT fn_empresas_produtivas())  -- [GE G0-F / RD-69] demos fora do Truth Auditor
    GROUP BY r.company_id, EXTRACT(YEAR FROM r.data_emissao), EXTRACT(MONTH FROM r.data_emissao)
  ),
  receita_psgc AS (
    -- [fix 2026-11-08] "encontrado" = Receita Operacional Bruta do DRE (igual fn_psgc_dre_consolidada),
    -- lida por dre_grupo='ROB' em competência. Antes: source='pr_4_4_re_etl_receita' (ETL morto -> 0).
    SELECT d.company_id, d.ano, d.mes, SUM(d.valor) AS valor_psgc
    FROM psgc_dre d
    JOIN psgc_contas c ON c.codigo = d.psgc_codigo
    WHERE COALESCE(d.regime,'competencia') = 'competencia' AND c.dre_grupo = 'ROB'
    GROUP BY d.company_id, d.ano, d.mes
  ),
  comparacao AS (
    SELECT r.company_id, r.ano, r.mes, r.valor_real, COALESCE(p.valor_psgc,0) AS valor_psgc, r.valor_real - COALESCE(p.valor_psgc,0) AS delta_abs,
           CASE WHEN r.valor_real>0 THEN ABS((r.valor_real - COALESCE(p.valor_psgc,0))/r.valor_real)*100 ELSE 0 END AS delta_pct
    FROM receita_real r LEFT JOIN receita_psgc p ON p.company_id=r.company_id AND p.ano=r.ano AND p.mes=r.mes
  )
  INSERT INTO erp_truth_alerts (rule_id, company_id, severity, area, tipo_divergencia, valor_esperado, valor_encontrado, delta_percentual, periodo_inicio, periodo_fim, evidencia, mensagem, recomendacao, status, detected_at)
  SELECT 'dre_receita_bate_nfs', c.company_id,
    -- [RD-38 2026-11-11] base de comparação em revisão (emissão×competência + escopo) -> nunca 'critical'.
    CASE WHEN c.delta_pct>5 OR ABS(c.delta_abs)>10000 THEN 'warn' ELSE 'info' END,
    'dre','receita_bruta_divergente', c.valor_real, c.valor_psgc, c.delta_pct,
    DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01'), (DATE(c.ano||'-'||LPAD(c.mes::text,2,'0')||'-01')+INTERVAL '1 month - 1 day')::date,
    jsonb_build_object('periodo',c.ano||'-'||LPAD(c.mes::text,2,'0'),'valor_real_erp_receber',c.valor_real,'valor_psgc_dre',c.valor_psgc,'delta_pct',ROUND(c.delta_pct::numeric,2),'base','reconciliacao_informativa_em_revisao'),
    CONCAT('Reconciliacao receita (informativa) R$ ',ROUND(ABS(c.delta_abs)::numeric,2),' (',ROUND(c.delta_pct::numeric,1),'%) na receita ',c.ano,'-',LPAD(c.mes::text,2,'0')),
    'Reconciliacao informativa: erp_receber (emissao, escopo amplo) x psgc_dre ROB (competencia). Eixo de data e escopo em alinhamento; nao e divergencia tela-x-fonte (a tela DRE le psgc_dre).',
    'novo', NOW()
  FROM comparacao c WHERE ABS(c.delta_pct)>1 OR ABS(c.delta_abs)>1000;
  GET DIAGNOSTICS v_alertas = ROW_COUNT;
  SELECT COUNT(DISTINCT company_id), COUNT(*) FILTER (WHERE severity='critical') INTO v_empresas, v_criticas FROM erp_truth_alerts WHERE rule_id='dre_receita_bate_nfs' AND status='novo';
  RETURN QUERY SELECT v_alertas, v_empresas, v_criticas;
END $function$;

-- check:fn-guards (régua da CI) — estas funções são SECURITY DEFINER re-definidas acima (CREATE OR REPLACE
-- NÃO altera ACL; nenhuma tem anon/PUBLIC hoje). Reafirma o REVOKE de anon/PUBLIC exigido pela régua, sem
-- tocar os grants de authenticated/service_role já existentes. fn_psgc_balanco_gerencial é STABLE (não DEFINER).
-- ci-sem-guarda: fn_ge_painel_contador — grava só contador_acessos_log (LGPD) do PRÓPRIO acesso, escopo por
-- p_contador_id (contador_clientes); SECURITY DEFINER sem GRANT a authenticated/anon (só service_role), chamada
-- server-side; não grava dado de negócio por empresa, então não há "empresa do registro" a conferir.
REVOKE ALL ON FUNCTION public.fn_contador_resumo_competencia(uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ge_painel_contador(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_analise_pessoas(uuid[],date,date,text,text[],integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_conciliacao(uuid[],date,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_diario(uuid[],text,integer,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_horizontal_dia(uuid[],integer,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_lancamentos(uuid[],text,date,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_truth_audit_dre() FROM PUBLIC, anon;
