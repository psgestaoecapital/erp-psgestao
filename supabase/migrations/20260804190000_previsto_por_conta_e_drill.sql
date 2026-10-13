-- RD-41 · Previsto (fluxo por vencimento) passa a cascatear por CONTA (psgc) + dia, com bucket
-- explícito "Sem classificação" (RD-51 · nada escondido/somado errado). Pilar 1: competência/caixa
-- INTOCADOS. Espelha o de-para dos outros regimes (RD-26). Duas funções:
--   1) fn_psgc_dre_horizontal_dia · ramo 'previsto' reescrito (grupo/conta/resultado).
--   2) fn_psgc_dre_diario · drill da conta passa a entender 'previsto' (vencimento, aberto, órfãos).

-- ─────────────────────────────────────────────────────────────────────────────────────────────
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

  -- REGIME 'previsto' (fluxo por vencimento) por CONTA + dia. Não passa pela máquina do DRE.
  IF v_regime = 'previsto' THEN
    v_saldo_ini := COALESCE(public.fn_saldo_bancos_dinamico(p_company_ids), 0);

    SELECT count(*) INTO v_empresas FROM (
      SELECT company_id FROM erp_receber WHERE company_id = ANY(p_company_ids) AND data_vencimento IS NOT NULL
        AND lower(COALESCE(status,'')) NOT IN ('pago','recebido','cancelado') AND data_vencimento::date BETWEEN v_ini AND v_fim
      UNION
      SELECT company_id FROM erp_pagar WHERE company_id = ANY(p_company_ids) AND data_vencimento IS NOT NULL
        AND lower(COALESCE(status,'')) NOT IN ('pago','cancelado') AND data_vencimento::date BETWEEN v_ini AND v_fim
    ) e;

    WITH ent AS (  -- receber a vencer, mapeado por de-para (órfão → NULL → Sem classificação)
      SELECT best.psgc_codigo AS codigo, r.data_vencimento::date AS dia, COALESCE(r.valor,0) AS valor
      FROM erp_receber r
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON true
      WHERE r.company_id = ANY(p_company_ids) AND r.data_vencimento IS NOT NULL
        AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado')
        AND r.data_vencimento::date BETWEEN v_ini AND v_fim
    ),
    sai AS (  -- pagar a vencer, mapeado por de-para de despesa (órfão → NULL)
      SELECT best.psgc_codigo AS codigo, p.data_vencimento::date AS dia, COALESCE(p.valor,0) AS valor
      FROM erp_pagar p
      LEFT JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON true
      WHERE p.company_id = ANY(p_company_ids) AND p.data_vencimento IS NOT NULL
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
  -- fim 'previsto'

  WITH raw AS (
    SELECT COALESCE(best.psgc_codigo, '1.4') AS psgc_codigo,
           (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) AS dia,
           COALESCE(r.valor,0) AS valor, r.company_id
    FROM erp_receber r
    LEFT JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    WHERE r.company_id = ANY(p_company_ids) AND (r.status IS NULL OR r.status <> 'cancelado')
      AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim
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
    WHERE v_regime = 'caixa' AND p.company_id = ANY(p_company_ids)
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND p.data_pagamento::date BETWEEN v_ini AND v_fim
  ),
  gmap(dre_grupo, header_ordem, sinal, nome, signo) AS (VALUES
    ('ROB',1000,'+','Receita Operacional Bruta',1),('DEDUCOES',2000,'-','(−) Deduções',-1),
    ('IMPOSTOS_VENDA',2100,'-','(−) Impostos sobre Vendas',-1),('CMV',3100,'-','(−) CMV / CPV / CSP',-1),
    ('DESP_VARIAVEL',4100,'-','(−) Despesas Variáveis',-1),('DESP_FIXA',5100,'-','(−) Despesas Fixas',-1),
    ('DEPREC_AMORT',6100,'-','(−) Depreciação e Amortização',-1),('RESULT_FIN',7100,'±','(±) Resultado Financeiro',-1),
    ('NAO_OPER',7200,'±','(±) Resultado Não-Operacional',-1),('IR_CSLL',8100,'-','(−) IR e CSLL',-1)
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
      COALESCE(SUM(v) FILTER (WHERE dre_grupo='IR_CSLL'),0) AS ir_csll
    FROM grp_dia GROUP BY ymd
  ),
  res AS (
    SELECT ymd,
      (rob-deducoes-impostos) AS rl, (rob-deducoes-impostos-cmv) AS mb,
      (rob-deducoes-impostos-cmv-desp_var) AS mc, (rob-deducoes-impostos-cmv-desp_var-desp_fixa) AS ebitda,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec) AS ebit,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper) AS rai,
      (rob-deducoes-impostos-cmv-desp_var-desp_fixa-deprec-result_fin-nao_oper-ir_csll) AS ll
    FROM pivot
  ),
  res_lines(ordem, codigo, nome) AS (VALUES
    (3000,'RL','= Receita Líquida'),(4000,'MB','= Margem Bruta'),(5000,'MC','= Margem de Contribuição'),
    (6000,'EBITDA','= EBITDA'),(7000,'EBIT','= EBIT (Resultado Operacional)'),
    (8000,'RAI','= Resultado antes do IR/CSLL'),(9000,'LL','= Lucro Líquido')
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
               WHEN 'LL' THEN r.ll END, 2))
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

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Drill da conta: entende 'previsto' (vencimento + status aberto) e as contas sentinela
-- 'PREV_SC_ENT'/'PREV_SC_SAI' (títulos órfãos — mostra a categoria de origem p/ facilitar o de-para).
-- competência/caixa: bloco original, intacto (só embrulhado no ELSE).
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

  -- is_receita: contas sentinela do previsto decidem pelo lado; demais, pelo psgc_contas.
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
        WHERE r.company_id = ANY(p_company_ids) AND r.data_vencimento IS NOT NULL
          AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado')
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
        WHERE p.company_id = ANY(p_company_ids) AND p.data_vencimento IS NOT NULL
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
    v_dre_mes := NULL;  -- previsto não é DRE: não há linha no psgc_dre p/ comparar
  ELSE
    -- ── competência/caixa · ORIGINAL, intacto ──────────────────────────────────────────────
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
        WHERE r.company_id = ANY(p_company_ids)
          AND (r.status IS NULL OR r.status <> 'cancelado')
          AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento ELSE r.data_emissao::timestamptz END) IS NOT NULL
          AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim
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
        WHERE p.company_id = ANY(p_company_ids)
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
