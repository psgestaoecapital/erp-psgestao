-- Indústria · Rendimento padrão por ORIGEM e por CORTE, calculado pelo MIX de entrada (decisão do CEO 25/11).
-- Tela 60 "Rendimento por origem e por corte" (blueprint vertical='industria').
--
-- Problema que isto resolve: fn_prod_rendimento_comparativo dividia o kg de um corte por CADA origem isolada
-- (saida_kg/origem_kg), contando o corte em dobro quando ele vem de mais de uma origem (ex.: coxão mole saindo da
-- bola 283 E da 284). O certo é o MIX: esperado = Σ_origens(entrada(origem) × rendimento_padrão/100) e o real do
-- corte é UM número só (kg de saída), nunca repartido por origem para efeito de total.
--
-- Fonte do real: sistema vinculado (ind_atak_fato, dominio 'producao_frigorifico') — ENTRADA na desossa =
-- PERFIL_TMV 'PCP0301' + COD_TIPO_MV 'F630'; SAÍDA (corte) = 'PCP0302' + 'F621'. Demais tipos ignorados.
-- Quando o produto não tem código vinculado com dado no período, cai no apontamento manual (prod_apontamento_hora).
-- RD-100: nada de nome de fornecedor — "sistema vinculado". RD-26: reusa prod_produto/prod_estrutura/apontamento.

-- ───────────────────────────── Índice do hot path (data × código no conector) ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ind_atak_fato_prod_data
  ON public.ind_atak_fato (company_id, dominio, (raw->>'DATA_ESTOQUE'), (raw->>'COD_PRODUTO'));

-- ───────────────────────────── Helper: códigos do sistema vinculado de cada produto ─────────────────────────────
-- chave_externa (sempre) + prod_produto_codigo_externo (SE a tabela existir — outro dev está criando; to_regclass
-- não quebra enquanto ela não existir). Supõe colunas (produto_id uuid, codigo text) na tabela futura.
CREATE OR REPLACE FUNCTION public.fn_prod_codigos_externos(p_company_id uuid, p_plant_id uuid)
 RETURNS TABLE(produto_id uuid, codigo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  RETURN QUERY
    SELECT pp.id, btrim(pp.chave_externa)
      FROM public.prod_produto pp
     WHERE pp.company_id = p_company_id AND pp.plant_id = p_plant_id
       AND pp.chave_externa IS NOT NULL AND btrim(pp.chave_externa) <> '';
  IF to_regclass('public.prod_produto_codigo_externo') IS NOT NULL THEN
    RETURN QUERY EXECUTE $q$
      SELECT ce.produto_id, btrim(ce.codigo)
        FROM public.prod_produto_codigo_externo ce
        JOIN public.prod_produto pp ON pp.id = ce.produto_id
       WHERE pp.company_id = $1 AND pp.plant_id = $2
         AND ce.codigo IS NOT NULL AND btrim(ce.codigo) <> ''
    $q$ USING p_company_id, p_plant_id;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_codigos_externos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_codigos_externos(uuid, uuid) TO authenticated, service_role;

-- ───────────────────────────── fn_prod_rendimento_mix ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prod_rendimento_mix(
  p_company_id uuid, p_plant_id uuid, p_data_ini date, p_data_fim date,
  p_fluxo_id uuid DEFAULT NULL, p_por_dia boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini text; v_fim_excl text; v_main jsonb; v_serie jsonb := NULL;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_data_ini IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;
  IF p_data_fim - p_data_ini > 120 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_maximo', 'limite_dias', 120);
  END IF;
  v_ini := to_char(p_data_ini, 'YYYY-MM-DD');
  v_fim_excl := to_char((p_data_fim + 1), 'YYYY-MM-DD');  -- texto ISO: inclui todo o dia final

  WITH codes AS (
    SELECT produto_id, codigo FROM public.fn_prod_codigos_externos(p_company_id, p_plant_id)
  ),
  atak_ent AS (  -- ENTRADA na desossa, por código e dia
    SELECT (raw->>'COD_PRODUTO') AS cod, (left(raw->>'DATA_ESTOQUE', 10))::date AS dia, sum((raw->>'QTDE_KG')::numeric) AS kg
      FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0301' AND raw->>'COD_TIPO_MV' = 'F630'
       AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl
     GROUP BY 1, 2
  ),
  atak_sai AS (  -- SAÍDA (corte produzido), por código e dia
    SELECT (raw->>'COD_PRODUTO') AS cod, (left(raw->>'DATA_ESTOQUE', 10))::date AS dia, sum((raw->>'QTDE_KG')::numeric) AS kg
      FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0302' AND raw->>'COD_TIPO_MV' = 'F621'
       AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl
     GROUP BY 1, 2
  ),
  ent_prod_dia AS (SELECT c.produto_id, e.dia, sum(e.kg) kg FROM atak_ent e JOIN codes c ON c.codigo = e.cod GROUP BY 1, 2),
  sai_prod_dia AS (SELECT c.produto_id, s.dia, sum(s.kg) kg FROM atak_sai s JOIN codes c ON c.codigo = s.cod GROUP BY 1, 2),
  apo_prod_dia AS (
    SELECT a.produto_id, a.data AS dia, sum(a.qtd_produzida) kg
      FROM public.prod_apontamento_hora a
     WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.excluido_em IS NULL
       AND a.data >= p_data_ini AND a.data <= p_data_fim
       AND (p_fluxo_id IS NULL OR a.fluxo_id = p_fluxo_id)
     GROUP BY 1, 2
  ),
  ent_tot AS (SELECT produto_id, sum(kg) kg FROM ent_prod_dia GROUP BY 1),
  sai_tot AS (SELECT produto_id, sum(kg) kg FROM sai_prod_dia GROUP BY 1),
  apo_tot AS (SELECT produto_id, sum(kg) kg FROM apo_prod_dia GROUP BY 1),
  pares AS (
    SELECT e.id AS eid, e.origem_produto_id AS oid, e.produto_id AS cid, e.tipo_saida, e.rendimento_padrao_pct AS pct,
           po.codigo AS ocod, po.nome AS onome, ps.codigo AS ccod, ps.nome AS cnome, ps.preco_venda_ref AS preco
      FROM public.prod_estrutura e
      JOIN public.prod_produto po ON po.id = e.origem_produto_id
      JOIN public.prod_produto ps ON ps.id = e.produto_id
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo
       AND (p_fluxo_id IS NULL OR e.fluxo_id = p_fluxo_id)
  ),
  origem_val AS (
    SELECT p.oid, min(p.ocod) ocod, min(p.onome) onome,
           COALESCE(et.kg, ap.kg) AS kg_entrada,
           CASE WHEN et.kg IS NOT NULL THEN 'sistema_vinculado' WHEN ap.kg IS NOT NULL THEN 'apontamento' END AS fonte
      FROM pares p
      LEFT JOIN ent_tot et ON et.produto_id = p.oid
      LEFT JOIN apo_tot ap ON ap.produto_id = p.oid
     GROUP BY p.oid, et.kg, ap.kg
  ),
  corte_val AS (
    SELECT p.cid, min(p.ccod) ccod, min(p.cnome) cnome, min(p.preco) preco,
           COALESCE(st.kg, ap.kg) AS real_kg,
           CASE WHEN st.kg IS NOT NULL THEN 'sistema_vinculado' WHEN ap.kg IS NOT NULL THEN 'apontamento' END AS fonte
      FROM pares p
      LEFT JOIN sai_tot st ON st.produto_id = p.cid
      LEFT JOIN apo_tot ap ON ap.produto_id = p.cid
     GROUP BY p.cid, st.kg, ap.kg
  ),
  pair_calc AS (
    SELECT p.cid, p.oid, p.eid, p.tipo_saida, p.pct, ov.ocod, ov.onome, ov.kg_entrada AS ent_kg, ov.fonte AS ofonte,
           CASE WHEN p.pct IS NOT NULL AND ov.kg_entrada IS NOT NULL THEN ov.kg_entrada * p.pct / 100.0 END AS esperado_kg
      FROM pares p JOIN origem_val ov ON ov.oid = p.oid
  ),
  corte_final AS (
    SELECT pc.cid, cv.ccod, cv.cnome, cv.preco, cv.real_kg, cv.fonte AS real_fonte,
           sum(pc.esperado_kg) AS esperado_kg,
           count(pc.pct) AS n_pct,
           jsonb_agg(jsonb_build_object(
             'origem_produto_id', pc.oid, 'origem_codigo', pc.ocod, 'origem_nome', pc.onome, 'estrutura_id', pc.eid,
             'kg_entrada', round(pc.ent_kg, 2), 'padrao_pct', pc.pct, 'esperado_kg', round(pc.esperado_kg, 2),
             'fonte_entrada', pc.ofonte
           ) ORDER BY pc.ocod) AS origens
      FROM pair_calc pc JOIN corte_val cv ON cv.cid = pc.cid
     GROUP BY pc.cid, cv.ccod, cv.cnome, cv.preco, cv.real_kg, cv.fonte
  ),
  origem_prop AS (  -- real repartido proporcional ao esperado (só informação na visão por origem)
    SELECT pc.oid, sum(cf.real_kg * pc.esperado_kg / NULLIF(cf.esperado_kg, 0)) AS real_prop
      FROM pair_calc pc JOIN corte_final cf ON cf.cid = pc.cid
     WHERE pc.esperado_kg IS NOT NULL AND cf.real_kg IS NOT NULL
     GROUP BY pc.oid
  ),
  origem_soma AS (SELECT oid, sum(pct) soma_pct FROM pares GROUP BY oid),
  cortes_js AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'corte_produto_id', cid, 'codigo', ccod, 'nome', cnome, 'preco_ref', preco,
      'esperado_kg', round(esperado_kg, 2),
      'real_kg', round(real_kg, 2),
      'fonte', real_fonte,
      'eficiencia_pct', CASE WHEN esperado_kg IS NOT NULL AND esperado_kg <> 0 AND real_kg IS NOT NULL THEN round(real_kg / esperado_kg * 100, 2) END,
      'dif_kg', CASE WHEN esperado_kg IS NOT NULL AND real_kg IS NOT NULL THEN round(real_kg - esperado_kg, 2) END,
      'dif_rs', CASE WHEN esperado_kg IS NOT NULL AND real_kg IS NOT NULL AND preco IS NOT NULL THEN round((real_kg - esperado_kg) * preco, 2) END,
      'status', CASE WHEN n_pct = 0 THEN 'sem_padrao' ELSE 'ok' END,
      'origens', origens
    ) ORDER BY ccod), '[]'::jsonb) js FROM corte_final
  ),
  origens_js AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'origem_produto_id', ov.oid, 'codigo', ov.ocod, 'nome', ov.onome,
      'kg_entrada', round(ov.kg_entrada, 2), 'fonte', ov.fonte,
      'soma_padrao_pct', round(os.soma_pct, 2),
      'soma_fora', (os.soma_pct IS NOT NULL AND (os.soma_pct < 97 OR os.soma_pct > 103)),
      'real_total_saida', round(op.real_prop, 2)
    ) ORDER BY ov.ocod), '[]'::jsonb) js
      FROM origem_val ov
      LEFT JOIN origem_soma os ON os.oid = ov.oid
      LEFT JOIN origem_prop op ON op.oid = ov.oid
  )
  SELECT jsonb_build_object('cortes', (SELECT js FROM cortes_js), 'origens', (SELECT js FROM origens_js))
    INTO v_main;

  IF p_por_dia THEN
    WITH codes AS (SELECT produto_id, codigo FROM public.fn_prod_codigos_externos(p_company_id, p_plant_id)),
    atak_ent AS (
      SELECT (raw->>'COD_PRODUTO') AS cod, (left(raw->>'DATA_ESTOQUE', 10))::date AS dia, sum((raw->>'QTDE_KG')::numeric) AS kg
        FROM public.ind_atak_fato
       WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
         AND raw->>'PERFIL_TMV' = 'PCP0301' AND raw->>'COD_TIPO_MV' = 'F630'
         AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl GROUP BY 1, 2),
    atak_sai AS (
      SELECT (raw->>'COD_PRODUTO') AS cod, (left(raw->>'DATA_ESTOQUE', 10))::date AS dia, sum((raw->>'QTDE_KG')::numeric) AS kg
        FROM public.ind_atak_fato
       WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
         AND raw->>'PERFIL_TMV' = 'PCP0302' AND raw->>'COD_TIPO_MV' = 'F621'
         AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl GROUP BY 1, 2),
    ent_prod_dia AS (SELECT c.produto_id, e.dia, sum(e.kg) kg FROM atak_ent e JOIN codes c ON c.codigo = e.cod GROUP BY 1, 2),
    sai_prod_dia AS (SELECT c.produto_id, s.dia, sum(s.kg) kg FROM atak_sai s JOIN codes c ON c.codigo = s.cod GROUP BY 1, 2),
    apo_prod_dia AS (
      SELECT a.produto_id, a.data AS dia, sum(a.qtd_produzida) kg FROM public.prod_apontamento_hora a
       WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.excluido_em IS NULL
         AND a.data >= p_data_ini AND a.data <= p_data_fim AND (p_fluxo_id IS NULL OR a.fluxo_id = p_fluxo_id) GROUP BY 1, 2),
    ent_tot AS (SELECT produto_id FROM ent_prod_dia GROUP BY 1),
    sai_tot AS (SELECT produto_id FROM sai_prod_dia GROUP BY 1),
    pares AS (SELECT e.origem_produto_id oid, e.produto_id cid, e.rendimento_padrao_pct pct FROM public.prod_estrutura e
       WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo AND (p_fluxo_id IS NULL OR e.fluxo_id = p_fluxo_id)),
    ent_src_dia AS (  -- entrada por produto/dia: vinculado se o produto tem vínculo com dado; senão apontamento
      SELECT produto_id, dia, kg FROM ent_prod_dia
      UNION ALL
      SELECT a.produto_id, a.dia, a.kg FROM apo_prod_dia a WHERE a.produto_id NOT IN (SELECT produto_id FROM ent_tot)),
    sai_src_dia AS (
      SELECT produto_id, dia, kg FROM sai_prod_dia
      UNION ALL
      SELECT a.produto_id, a.dia, a.kg FROM apo_prod_dia a WHERE a.produto_id NOT IN (SELECT produto_id FROM sai_tot)),
    esp_dia AS (
      SELECT d.dia, sum(d.kg * p.pct / 100.0) esp
        FROM pares p JOIN ent_src_dia d ON d.produto_id = p.oid WHERE p.pct IS NOT NULL GROUP BY d.dia),
    real_dia AS (
      SELECT s.dia, sum(s.kg) real FROM sai_src_dia s
       WHERE s.produto_id IN (SELECT DISTINCT cid FROM pares) GROUP BY s.dia)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'dia', dia, 'esperado_kg', round(esp, 2), 'real_kg', round(real, 2),
      'eficiencia_pct', CASE WHEN esp IS NOT NULL AND esp <> 0 AND real IS NOT NULL THEN round(real / esp * 100, 2) END
    ) ORDER BY dia), '[]'::jsonb)
      INTO v_serie
      FROM (SELECT COALESCE(e.dia, r.dia) dia, e.esp, r.real FROM esp_dia e FULL JOIN real_dia r ON r.dia = e.dia) z;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim),
    'cortes', v_main->'cortes',
    'origens', v_main->'origens',
    'serie', v_serie
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_rendimento_mix(uuid, uuid, date, date, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rendimento_mix(uuid, uuid, date, date, uuid, boolean) TO authenticated, service_role;

-- ───────────────────────────── fn_prod_rendimento_sugerir (regressão pelo histórico) ─────────────────────────────
-- Para cada corte da estrutura, sugere o rendimento padrão de cada origem pela regressão SEM intercepto dos dias com
-- entrada e saída no sistema vinculado. 1 origem: pct = 100·Σxy/Σx². 2 origens: equações normais 2×2 (Cramer); matriz
-- quase singular → 'colinear'. 3+ origens → 'muitas_origens'. pct fora de (0,100] → 'nao_confiavel'.
CREATE OR REPLACE FUNCTION public.fn_prod_rendimento_sugerir(
  p_company_id uuid, p_plant_id uuid, p_dias int DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date; v_fim date; v_ini_t text; v_fim_excl_t text; v_out jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 120 THEN p_dias := 60; END IF;
  v_fim := current_date;
  v_ini := v_fim - (p_dias - 1);
  v_ini_t := to_char(v_ini, 'YYYY-MM-DD');
  v_fim_excl_t := to_char((v_fim + 1), 'YYYY-MM-DD');

  WITH codes AS (SELECT produto_id, codigo FROM public.fn_prod_codigos_externos(p_company_id, p_plant_id)),
  atak_ent AS (
    SELECT (raw->>'COD_PRODUTO') cod, (left(raw->>'DATA_ESTOQUE', 10))::date dia, sum((raw->>'QTDE_KG')::numeric) kg
      FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0301' AND raw->>'COD_TIPO_MV' = 'F630'
       AND (raw->>'DATA_ESTOQUE') >= v_ini_t AND (raw->>'DATA_ESTOQUE') < v_fim_excl_t GROUP BY 1, 2),
  atak_sai AS (
    SELECT (raw->>'COD_PRODUTO') cod, (left(raw->>'DATA_ESTOQUE', 10))::date dia, sum((raw->>'QTDE_KG')::numeric) kg
      FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0302' AND raw->>'COD_TIPO_MV' = 'F621'
       AND (raw->>'DATA_ESTOQUE') >= v_ini_t AND (raw->>'DATA_ESTOQUE') < v_fim_excl_t GROUP BY 1, 2),
  ent_pd AS (SELECT c.produto_id, e.dia, sum(e.kg) kg FROM atak_ent e JOIN codes c ON c.codigo = e.cod GROUP BY 1, 2),
  sai_pd AS (SELECT c.produto_id, s.dia, sum(s.kg) kg FROM atak_sai s JOIN codes c ON c.codigo = s.cod GROUP BY 1, 2),
  pares AS (
    SELECT e.produto_id cid, e.origem_produto_id oid, e.rendimento_padrao_pct pct_atual,
           po.codigo ocod, po.nome onome, ps.codigo ccod, ps.nome cnome
      FROM public.prod_estrutura e
      JOIN public.prod_produto po ON po.id = e.origem_produto_id
      JOIN public.prod_produto ps ON ps.id = e.produto_id
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo),
  norig AS (SELECT cid, count(*) n FROM pares GROUP BY cid),
  -- dias com saída do corte (y) e, por origem, entrada (x, 0 quando não houve)
  pd AS (
    SELECT p.cid, p.oid, p.pct_atual, p.ocod, p.onome, p.ccod, p.cnome,
           s.dia, COALESCE(en.kg, 0) x, s.kg y,
           dense_rank() OVER (PARTITION BY p.cid ORDER BY p.oid) rn
      FROM pares p
      JOIN sai_pd s ON s.produto_id = p.cid
      LEFT JOIN ent_pd en ON en.produto_id = p.oid AND en.dia = s.dia),
  -- 1 origem: Σxy, Σx², Σy², nº de dias
  um AS (
    SELECT pd.cid, pd.oid, min(pd.pct_atual) pct_atual, min(pd.ocod) ocod, min(pd.onome) onome,
           min(pd.ccod) ccod, min(pd.cnome) cnome,
           sum(pd.x * pd.y) sxy, sum(pd.x * pd.x) sxx, sum(pd.y * pd.y) syy, count(*) dias
      FROM pd JOIN norig n ON n.cid = pd.cid AND n.n = 1
     GROUP BY pd.cid, pd.oid),
  um_js AS (
    SELECT cid, jsonb_agg(jsonb_build_object(
      'origem_produto_id', oid, 'origem_codigo', ocod, 'origem_nome', onome,
      'corte_codigo', ccod, 'corte_nome', cnome, 'dias', dias, 'pct_atual', pct_atual,
      'resultado', CASE WHEN dias < 2 OR sxx = 0 THEN 'sem_dados'
                        WHEN 100.0 * sxy / sxx <= 0 OR 100.0 * sxy / sxx > 100 THEN 'nao_confiavel'
                        ELSE 'ok' END,
      'pct_sugerido', CASE WHEN dias >= 2 AND sxx > 0 THEN round(100.0 * sxy / sxx, 2) END,
      'r2', CASE WHEN dias >= 2 AND sxx > 0 AND syy > 0
                 THEN round(1 - (syy - (sxy * sxy / sxx)) / syy, 4) END
    ) ORDER BY ocod) js FROM um GROUP BY cid),
  -- 2 origens: pivô x1/x2/y por (corte,dia) e equações normais 2×2 (Cramer)
  piv AS (
    SELECT pd.cid, pd.dia, max(pd.y) y,
           max(pd.x) FILTER (WHERE pd.rn = 1) x1, max(pd.x) FILTER (WHERE pd.rn = 2) x2,
           (max(pd.oid::text) FILTER (WHERE pd.rn = 1))::uuid o1, (max(pd.oid::text) FILTER (WHERE pd.rn = 2))::uuid o2
      FROM pd JOIN norig n ON n.cid = pd.cid AND n.n = 2
     GROUP BY pd.cid, pd.dia),
  dois AS (
    SELECT cid, (max(o1::text))::uuid o1, (max(o2::text))::uuid o2,
           sum(COALESCE(x1,0)*COALESCE(x1,0)) a11, sum(COALESCE(x2,0)*COALESCE(x2,0)) a22,
           sum(COALESCE(x1,0)*COALESCE(x2,0)) a12, sum(COALESCE(x1,0)*y) b1, sum(COALESCE(x2,0)*y) b2,
           sum(y*y) syy, count(*) dias
      FROM piv GROUP BY cid),
  dois_calc AS (
    SELECT d.cid, d.o1, d.o2, d.dias, d.syy,
           (d.a11*d.a22 - d.a12*d.a12) det,
           d.a11, d.a22, d.a12, d.b1, d.b2,
           CASE WHEN (d.a11*d.a22 - d.a12*d.a12) <> 0 THEN (d.b1*d.a22 - d.a12*d.b2) / (d.a11*d.a22 - d.a12*d.a12) END k1,
           CASE WHEN (d.a11*d.a22 - d.a12*d.a12) <> 0 THEN (d.a11*d.b2 - d.b1*d.a12) / (d.a11*d.a22 - d.a12*d.a12) END k2
      FROM dois d),
  -- quase singular: |det| pequeno perto do produto das diagonais → colinear
  dois_js AS (
    SELECT dc.cid, jsonb_agg(x ORDER BY x->>'origem_codigo') js FROM dois_calc dc
      CROSS JOIN LATERAL (
        VALUES
          (dc.o1, dc.k1), (dc.o2, dc.k2)
      ) AS v(oid, k)
      CROSS JOIN LATERAL (
        SELECT jsonb_build_object(
          'origem_produto_id', v.oid, 'origem_codigo', pp.codigo, 'origem_nome', pp.nome,
          'corte_codigo', ps.codigo, 'corte_nome', ps.nome, 'dias', dc.dias, 'pct_atual', pe.rendimento_padrao_pct,
          'resultado', CASE WHEN dc.dias < 3 THEN 'sem_dados'
                            WHEN dc.det = 0 OR abs(dc.det) < 1e-6 * (dc.a11 * dc.a22) THEN 'colinear'
                            WHEN v.k * 100.0 <= 0 OR v.k * 100.0 > 100 THEN 'nao_confiavel'
                            ELSE 'ok' END,
          'pct_sugerido', CASE WHEN dc.dias >= 3 AND dc.det <> 0 AND NOT (abs(dc.det) < 1e-6 * (dc.a11 * dc.a22)) THEN round(v.k * 100.0, 2) END,
          'r2', CASE WHEN dc.dias >= 3 AND dc.det <> 0 AND dc.syy > 0
                     THEN round(1 - (dc.syy - (dc.k1*dc.b1 + dc.k2*dc.b2)) / dc.syy, 4) END
        ) AS x
        FROM public.prod_produto pp
        JOIN public.prod_produto ps ON ps.id = dc.cid
        LEFT JOIN public.prod_estrutura pe ON pe.company_id = p_company_id AND pe.plant_id = p_plant_id
             AND pe.ativo AND pe.origem_produto_id = v.oid AND pe.produto_id = dc.cid
        WHERE pp.id = v.oid
      ) sub
     GROUP BY dc.cid),
  muitas AS (
    SELECT n.cid, min(ps.codigo) ccod, min(ps.nome) cnome FROM norig n
      JOIN public.prod_produto ps ON ps.id = n.cid WHERE n.n >= 3 GROUP BY n.cid),
  todos AS (
    SELECT p.cid, p.ccod, p.cnome, n.n AS n_origens,
           CASE WHEN n.n >= 3 THEN 'muitas_origens' ELSE 'ok' END AS corte_status,
           COALESCE((SELECT js FROM um_js u WHERE u.cid = p.cid),
                    (SELECT js FROM dois_js d WHERE d.cid = p.cid),
                    '[]'::jsonb) AS pares
      FROM (SELECT DISTINCT cid, ccod, cnome FROM pares) p
      JOIN norig n ON n.cid = p.cid)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'corte_produto_id', cid, 'corte_codigo', ccod, 'corte_nome', cnome,
    'n_origens', n_origens, 'status', corte_status, 'origens', pares
  ) ORDER BY ccod), '[]'::jsonb) INTO v_out FROM todos;

  RETURN jsonb_build_object('ok', true, 'dias', p_dias, 'cortes', v_out);
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_rendimento_sugerir(uuid, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rendimento_sugerir(uuid, uuid, int) TO authenticated, service_role;

-- ───────────────────────────── fn_prod_estrutura_do_produto (árvore: oriundo de / gera) ─────────────────────────────
-- Para a tela Produtos (item 6): de quais origens um corte vem (com % de cada) e, numa origem, quais cortes saem
-- dela e a soma dos %. Só leitura.
CREATE OR REPLACE FUNCTION public.fn_prod_estrutura_do_produto(
  p_company_id uuid, p_plant_id uuid, p_produto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_oriundo jsonb; v_gera jsonb; v_soma numeric;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'origem_produto_id', e.origem_produto_id, 'codigo', po.codigo, 'nome', po.nome,
           'tipo_saida', e.tipo_saida, 'padrao_pct', e.rendimento_padrao_pct) ORDER BY po.codigo), '[]'::jsonb)
    INTO v_oriundo
    FROM public.prod_estrutura e JOIN public.prod_produto po ON po.id = e.origem_produto_id
   WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.produto_id = p_produto_id AND e.ativo;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'produto_id', e.produto_id, 'codigo', ps.codigo, 'nome', ps.nome,
           'tipo_saida', e.tipo_saida, 'padrao_pct', e.rendimento_padrao_pct) ORDER BY ps.codigo), '[]'::jsonb),
         sum(e.rendimento_padrao_pct)
    INTO v_gera, v_soma
    FROM public.prod_estrutura e JOIN public.prod_produto ps ON ps.id = e.produto_id
   WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.origem_produto_id = p_produto_id AND e.ativo;

  RETURN jsonb_build_object('ok', true, 'oriundo_de', v_oriundo, 'gera', v_gera,
    'soma_gera_pct', round(v_soma, 2),
    'soma_fora', (v_soma IS NOT NULL AND (v_soma < 97 OR v_soma > 103)));
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_estrutura_do_produto(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_estrutura_do_produto(uuid, uuid, uuid) TO authenticated, service_role;

-- ───────────────────────────── fn_prod_estrutura_pct (edição no lugar / aprovar sugestão) ─────────────────────────────
-- Atualiza SÓ o rendimento padrão (e, opcionalmente, a fonte) de uma ligação origem→corte existente, preservando
-- tipo_saida, status, fluxo e vigências. Usado pela matriz "Origem × corte" (edição no lugar) e pelo "Aprovar"
-- da sugestão (fonte 'historico_aprovado'). Mais seguro que reescrever a linha inteira por fn_prod_estrutura_salvar.
CREATE OR REPLACE FUNCTION public.fn_prod_estrutura_pct(
  p_company_id uuid, p_plant_id uuid, p_id uuid, p_rendimento_pct numeric, p_fonte_padrao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_oid uuid; v_soma numeric;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_rendimento_pct IS NOT NULL AND (p_rendimento_pct <= 0 OR p_rendimento_pct > 100) THEN RAISE EXCEPTION 'rendimento_invalido'; END IF;
  UPDATE public.prod_estrutura
     SET rendimento_padrao_pct = p_rendimento_pct,
         fonte_padrao = COALESCE(p_fonte_padrao, fonte_padrao),
         atualizado_por = auth.uid()
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id AND ativo
   RETURNING id, origem_produto_id INTO v_id, v_oid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'estrutura_nao_encontrada'; END IF;
  SELECT sum(rendimento_padrao_pct) INTO v_soma FROM public.prod_estrutura
   WHERE company_id = p_company_id AND plant_id = p_plant_id AND origem_produto_id = v_oid AND ativo;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'soma_origem_pct', round(v_soma, 2),
    'soma_fora', (v_soma IS NOT NULL AND (v_soma < 97 OR v_soma > 103)));
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_estrutura_pct(uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_estrutura_pct(uuid, uuid, uuid, numeric, text) TO authenticated, service_role;

-- ───────────────────────────── fn_prod_rendimento_comparativo: real pelo MIX (mesma assinatura e retorno) ──────────
-- Telas antigas continuam chamando com a MESMA assinatura e lendo o MESMO formato (origens[].saidas[]), mas o real
-- agora é repartido proporcional ao esperado (nunca o corte em dobro) e lê sistema vinculado + apontamento.
CREATE OR REPLACE FUNCTION public.fn_prod_rendimento_comparativo(
  p_company_id uuid, p_plant_id uuid, p_data_ini date, p_data_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ini text; v_fim_excl text; v_origens jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_data_ini IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;
  v_ini := to_char(p_data_ini, 'YYYY-MM-DD');
  v_fim_excl := to_char((p_data_fim + 1), 'YYYY-MM-DD');

  WITH codes AS (SELECT produto_id, codigo FROM public.fn_prod_codigos_externos(p_company_id, p_plant_id)),
  atak_ent AS (
    SELECT (raw->>'COD_PRODUTO') cod, sum((raw->>'QTDE_KG')::numeric) kg FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0301' AND raw->>'COD_TIPO_MV' = 'F630'
       AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl GROUP BY 1),
  atak_sai AS (
    SELECT (raw->>'COD_PRODUTO') cod, sum((raw->>'QTDE_KG')::numeric) kg FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0302' AND raw->>'COD_TIPO_MV' = 'F621'
       AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl GROUP BY 1),
  apo AS (SELECT a.produto_id, sum(a.qtd_produzida) kg FROM public.prod_apontamento_hora a
     WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.excluido_em IS NULL
       AND a.data >= p_data_ini AND a.data <= p_data_fim GROUP BY 1),
  ent_tot AS (SELECT c.produto_id, sum(e.kg) kg FROM atak_ent e JOIN codes c ON c.codigo = e.cod GROUP BY 1),
  sai_tot AS (SELECT c.produto_id, sum(s.kg) kg FROM atak_sai s JOIN codes c ON c.codigo = s.cod GROUP BY 1),
  pares AS (
    SELECT e.origem_produto_id oid, e.produto_id cid, e.tipo_saida, e.rendimento_padrao_pct pct,
           po.codigo ocod, po.nome onome, ps.codigo scod, ps.nome snome, ps.preco_venda_ref preco
      FROM public.prod_estrutura e JOIN public.prod_produto po ON po.id = e.origem_produto_id
      JOIN public.prod_produto ps ON ps.id = e.produto_id
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo),
  origem_kg AS (SELECT p.oid, COALESCE(et.kg, ap.kg) kg FROM (SELECT DISTINCT oid FROM pares) p
      LEFT JOIN ent_tot et ON et.produto_id = p.oid LEFT JOIN apo ap ON ap.produto_id = p.oid),
  corte_kg AS (SELECT p.cid, COALESCE(st.kg, ap.kg) kg FROM (SELECT DISTINCT cid FROM pares) p
      LEFT JOIN sai_tot st ON st.produto_id = p.cid LEFT JOIN apo ap ON ap.produto_id = p.cid),
  pc AS (  -- por par: esperado da origem e esperado total do corte (p/ repartir o real)
    SELECT p.*, ok.kg origem_kg, ck.kg corte_real,
           CASE WHEN p.pct IS NOT NULL AND ok.kg IS NOT NULL THEN ok.kg * p.pct / 100.0 END esp_origem
      FROM pares p LEFT JOIN origem_kg ok ON ok.oid = p.oid LEFT JOIN corte_kg ck ON ck.cid = p.cid),
  pc2 AS (
    SELECT pc.*, sum(esp_origem) OVER (PARTITION BY cid) esp_total_corte FROM pc),
  por_saida AS (
    SELECT oid, ocod, onome, origem_kg, (origem_kg IS NOT NULL) tem_real, pct,
      jsonb_build_object(
        'produto_id', cid, 'codigo', scod, 'nome', snome, 'tipo_saida', tipo_saida, 'padrao_pct', pct,
        'esperado_kg', CASE WHEN origem_kg IS NOT NULL THEN round(origem_kg * COALESCE(pct,0)/100.0, 2) END,
        'real_kg', CASE WHEN corte_real IS NOT NULL AND esp_total_corte IS NOT NULL AND esp_total_corte <> 0 AND esp_origem IS NOT NULL
                        THEN round(corte_real * esp_origem / esp_total_corte, 2) END,
        'real_pct', CASE WHEN origem_kg IS NOT NULL AND origem_kg <> 0 AND corte_real IS NOT NULL AND esp_total_corte IS NOT NULL AND esp_total_corte <> 0 AND esp_origem IS NOT NULL
                        THEN round(corte_real * esp_origem / esp_total_corte / origem_kg * 100.0, 2) END,
        'diff_pct', NULL::numeric,
        'diff_kg', CASE WHEN origem_kg IS NOT NULL AND corte_real IS NOT NULL AND esp_total_corte IS NOT NULL AND esp_total_corte <> 0 AND esp_origem IS NOT NULL
                        THEN round(corte_real * esp_origem / esp_total_corte - origem_kg * COALESCE(pct,0)/100.0, 2) END,
        'preco_ref', preco,
        'diff_rs', CASE WHEN origem_kg IS NOT NULL AND corte_real IS NOT NULL AND preco IS NOT NULL AND esp_total_corte IS NOT NULL AND esp_total_corte <> 0 AND esp_origem IS NOT NULL
                        THEN round((corte_real * esp_origem / esp_total_corte - origem_kg * COALESCE(pct,0)/100.0) * preco, 2) END
      ) saida
    FROM pc2),
  agrup AS (
    SELECT oid, max(ocod) ocod, max(onome) onome, max(origem_kg) origem_kg, bool_or(tem_real) tem_real,
           sum(pct) soma_padrao,
           jsonb_agg(saida ORDER BY (saida->>'tipo_saida'), (saida->>'codigo')) saidas
      FROM por_saida GROUP BY oid)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'origem_produto_id', oid, 'origem_codigo', ocod, 'origem_nome', onome,
           'origem_kg', CASE WHEN tem_real THEN round(origem_kg, 2) END, 'tem_real', tem_real,
           'soma_padrao_pct', round(soma_padrao, 2), 'soma_real_pct', NULL::numeric,
           'soma_fora_100', (soma_padrao IS NOT NULL AND (soma_padrao < 97 OR soma_padrao > 103)),
           'saidas', saidas) ORDER BY ocod), '[]'::jsonb) INTO v_origens FROM agrup;

  RETURN jsonb_build_object('ok', true, 'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim), 'origens', v_origens);
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_rendimento_comparativo(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rendimento_comparativo(uuid, uuid, date, date) TO authenticated, service_role;

-- ───────────────────────────── Ajuda de campo (RD-95) — chaves novas da tela Rendimento e Produtos ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('prod.rendimento.raia', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Raia (fluxo)',
  'Escolha a raia do fluxo (ex.: Desossa) para ver só as origens e cortes dela, ou deixe em "Todas".',
  'Separa o rendimento por etapa do processo quando a planta tem mais de um fluxo.',
  'Desossa', 'Deixar em "Todas" quando a planta tem fluxos diferentes e os números se misturam.', 'industria', 1, 1, 'publicado'),
 ('prod.rendimento.matriz', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Origem × corte (padrão %)',
  'Em cada célula, o rendimento padrão em % do corte (coluna) a partir daquela origem (linha). Clique para editar.',
  'É o padrão que o sistema usa para calcular o esperado: entrada da origem × esse % = quanto deveria sair daquele corte.',
  'Bola 283 → coxão mole 28%', 'Deixar a soma de uma origem muito longe de 100% — confira as saídas que faltam.', 'industria', 2, 1, 'publicado'),
 ('prod.rendimento.matriz_celula', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Rendimento padrão da célula (%)',
  'O percentual padrão daquele corte vindo daquela origem. Vazio = sem padrão definido ainda.',
  'Cada par origem→corte tem o seu próprio padrão; é ele que entra no cálculo do esperado.',
  '28 (para 28%)', 'Pôr 0: o sistema não aceita zero — deixe vazio se ainda não sabe.', 'industria', 3, 1, 'publicado'),
 ('prod.rendimento.esperado_kg', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Esperado (kg)',
  'Quanto deveria sair do corte no período, somando todas as origens: Σ (entrada da origem × padrão/100).',
  'É a meta de produção do corte dada pelo mix de entrada que de fato aconteceu.',
  'Bola 283 (44,8 t × 28%) + bola 284 (72,8 t × 28%)', 'Comparar esperado com real quando ainda falta cadastrar o padrão de alguma origem.', 'industria', 4, 1, 'publicado'),
 ('prod.rendimento.real_kg', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Real (kg)',
  'Quanto de fato saiu do corte no período (um número só, somando todas as origens).',
  'Comparado com o esperado, mostra se o rendimento ficou acima ou abaixo do padrão.',
  '32.982 kg de coxão mole', 'Achar que o real é por origem — o real do corte é único; as origens dividem só para informação.', 'industria', 5, 1, 'publicado'),
 ('prod.rendimento.eficiencia', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Eficiência (%)',
  'Real ÷ esperado × 100. Acima de 100% rendeu mais que o padrão; abaixo, menos.',
  'Resume num número se o corte está rendendo conforme o padrão daquele mix de entrada.',
  'Real 32.982 / esperado 32.000 = 103%', 'Ler a eficiência quando o esperado é zero (sem padrão) — aí ela não aparece.', 'industria', 6, 1, 'publicado'),
 ('prod.rendimento.fonte', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Fonte do dado',
  'De onde veio o real: "sistema vinculado" (conector) ou "apontamento" (lançado à mão).',
  'Deixa claro se o número é do conector ou do apontamento, para você confiar no comparativo.',
  'sistema vinculado', 'Confiar no real quando não há fonte nenhuma no período.', 'industria', 7, 1, 'publicado'),
 ('prod.rendimento.grafico_dia', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Eficiência por dia',
  'A eficiência (real ÷ esperado) dia a dia no período.',
  'Mostra em que dias o rendimento caiu ou subiu, para investigar o que mudou na produção.',
  'Queda no dia 12', 'Tirar conclusão de um dia só com pouca entrada.', 'industria', 8, 1, 'publicado'),
 ('prod.rendimento.sugerir', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Sugerir pelo histórico',
  'Calcula um padrão sugerido para cada origem a partir dos últimos dias do sistema vinculado.',
  'Ajuda a preencher o padrão quando você ainda não sabe o rendimento de cada origem — depois é só aprovar ou ajustar.',
  '28,3% com R² 0,94', 'Aprovar uma sugestão com R² baixo ou poucos dias — confira antes.', 'industria', 9, 1, 'publicado'),
 ('prod.rendimento.sugerir_r2', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Confiança (R²)',
  'Quão bem o padrão sugerido explica o histórico (0 a 1). Quanto mais perto de 1, mais confiável.',
  'Serve para você decidir se aceita a sugestão ou pede mais dados.',
  '0,94 (alta)', 'Aprovar sugestão com R² baixo (ex.: 0,3).', 'industria', 10, 1, 'publicado'),
 ('prod.rendimento.aprovar', '/dashboard/produtividade/rendimento', 'Rendimentos', 'Aprovar sugestão',
  'Grava o padrão sugerido (ou o que você ajustou) como rendimento padrão daquele par origem→corte.',
  'Transforma a sugestão do histórico no padrão oficial que passa a valer no cálculo.',
  'Aprovar 28,3% para bola 283 → coxão mole', 'Aprovar sem revisar o valor quando a confiança é baixa.', 'industria', 11, 1, 'publicado'),
 ('prod.produto.oriundo_de', '/dashboard/produtividade/produtos', 'Produtos', 'Corte oriundo de',
  'As origens de onde este corte sai, com o rendimento padrão % de cada uma.',
  'Mostra, para um corte, de quais matérias-primas ele vem e em que proporção.',
  'Coxão mole vem da bola 283 (28%) e da bola 284 (28%)', 'Supor uma origem só quando o corte vem de várias.', 'industria', 20, 1, 'publicado'),
 ('prod.produto.gera_cortes', '/dashboard/produtividade/produtos', 'Produtos', 'Cortes que saem desta origem',
  'Os cortes que saem desta origem e a soma dos rendimentos padrão.',
  'Mostra, para uma matéria-prima, tudo o que ela gera e se a soma fecha perto de 100%.',
  'Bola 284 → coxão mole, coxão duro, patinho… soma 99%', 'Ignorar quando a soma fica longe de 100% (falta saída cadastrada).', 'industria', 21, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, status = EXCLUDED.status, atualizado_em = now();
