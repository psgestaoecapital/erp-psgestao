-- Contagem de cabeças compra × abate (RD-38, prova em erp_contexto_projeto 54cda9a1 · pacote Eng. Chefe 27/11 item 3).
-- Code: code-desenvolvedor-3
--
-- (a) fn_ind_abate_animal contava 2× o animal que vem com 2 linhas de produto no romaneio (ex.: "02 FEMEA PARA ABATE"
--     + "99 VACA TF", mesmo peso). Chave do animal = COD_DOCTO, NUM_DOCTO, SERIE_SEQ, SEQ_ABATE (sem COD_PRODUTO);
--     fica a linha mais recente (imported_at DESC) e, no empate, o menor COD_PRODUTO. Prova FRIOESTE 01–26/11 (dias
--     fechados): RAA 1.229 → 1.220 (−9; com os 12 de 27/11 da prova do Eng. Chefe = 1.241 → 1.232), RAT 48 → 44. Mesmas colunas: BI Abate, BI da Planta e Compra × abate leem igual.
-- (b) fn_ind_compra_gado_item passa a ler a compra de PJ (COD_TIPO_MV T255, doc NEE) de produto de abate.
--     PROVA NO DADO (RD-38, 27/11): o T255 de nov tem 160 linhas de abate e R$ 3,3 mi, mas 128 delas (R$ 3,13 mi,
--     série 910/026) são a NOTA DO PRÓPRIO PRODUTOR sobre o MESMO lote que já tem contra-nota T231 do mesmo produtor
--     no mesmo dia (ex.: Arthur 15 cab R$ 87.000 × T231 12+3 cab; Valdir 14 × 9+3+2; Vitor 17 × 13+1+1+2). Somar
--     essas linhas contaria o lote 2×. Regra: T255 entra só quando NÃO há T231 do mesmo produtor em ±3 dias, e nunca
--     linha de ajuste (QTDE_PRI <= 10 kg). Em nov sobra a compra PJ real: FAZENDA TRÊS CURVAS LTDA, NEE 643,
--     3.514 kg, 16 cabeças (QTDE_AUX coerente, 196–269 kg/cab). O "≈ 30 cab / 7.053 kg" do pedido somava as notas
--     de produtor repetidas.
--     Cabeças: QTDE_AUX quando coerente com o peso (120–450 kg por cabeça); senão peso ÷ carcaça média das contra-notas
--     T231 do período, com cabecas_estimadas = true. Colunas novas no fim (compra_pj, cabecas_estimadas) → DROP +
--     CREATE do tradutor (só a porta fn_bi_compra_gado_painel o lê; tradutor segue sem EXECUTE para a tela).
-- (c) fn_bi_compra_gado_painel: o bloco "abate" compara só DIAS FECHADOS (até ontem, horário de Brasília) e abre a
--     diferença em parcelas: notas ainda não emitidas (abate de hoje) · compra PJ · sem nota de compra.
-- Não toca coleta/ETL (ind_atak_fato só é lido). fn_ind_compra_gado (BI da Planta) fica como está.

-- ── (a) Abate: um animal = uma linha ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ind_abate_animal(p_company_id uuid, p_de date, p_ate date)
 RETURNS TABLE(origem text, dia date, animal text, categoria text, sexo text, classificacao text, peso numeric, terceiro boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (f.raw->>'COD_DOCTO', f.raw->>'NUM_DOCTO', f.raw->>'SERIE_SEQ', f.raw->>'SEQ_ABATE')
    'atak'::text,
    left(f.raw->>'DATA_ABATE', 10)::date,
    concat_ws('|', f.raw->>'COD_DOCTO', f.raw->>'NUM_DOCTO', f.raw->>'SERIE_SEQ', f.raw->>'SEQ_ABATE'),
    trim(f.raw->>'DESC_PRODUTO_EST'),
    CASE WHEN f.raw->>'SEXO' IN ('F','M') THEN f.raw->>'SEXO' END,
    trim(f.raw->>'DESC_CLASSIF'),
    coalesce((f.raw->>'PESO')::numeric, 0),
    f.raw->>'COD_DOCTO' = 'RAT'
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id AND f.dominio = 'miudos_5quarto'
    AND f.raw->>'COD_DOCTO' IN ('RAA', 'RAT')
    AND f.raw->>'DATA_ABATE' >= p_de::text AND f.raw->>'DATA_ABATE' < (p_ate + 1)::text
  ORDER BY f.raw->>'COD_DOCTO', f.raw->>'NUM_DOCTO', f.raw->>'SERIE_SEQ', f.raw->>'SEQ_ABATE', f.imported_at DESC, f.raw->>'COD_PRODUTO'
$function$;

REVOKE ALL ON FUNCTION public.fn_ind_abate_animal(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ── (b) Compra: + compra PJ (T255) sem repetir a nota do produtor ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_ind_compra_gado_item(uuid, date, date);
CREATE OR REPLACE FUNCTION public.fn_ind_compra_gado_item(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE (origem text, dia date, documento text, produtor_cod text, produtor text, cidade text, uf text,
               finalidade text, categoria text, sexo text, nota10 boolean, cabecas numeric, kg numeric, valor numeric,
               prazo_dias numeric, cond_pgto text, transportador text, compra_pj boolean, cabecas_estimadas boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  -- Ramo ATAK (importação ind_atak_fato, domínio compra_gado). Outro ERP: novo SELECT com as mesmas colunas, UNION ALL.
  WITH base AS MATERIALIZED (
    SELECT f.raw, f.raw->>'COD_TIPO_MV' AS tmv, left(f.raw->>'DATA_MOVTO', 10)::date AS dt,
           trim(f.raw->>'COD_CLI_FOR') AS cf,
           coalesce((f.raw->>'QTDE_PRI')::numeric, 0) AS qpri, coalesce((f.raw->>'QTDE_AUX')::numeric, 0) AS qaux
    FROM public.ind_atak_fato f
    WHERE f.company_id = p_company_id AND f.dominio = 'compra_gado'
      -- guarda de empresa (multi-tenant): SECURITY DEFINER ignora RLS e o UUID da empresa não é segredo.
      AND (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      AND f.raw->>'COD_TIPO_MV' IN ('T231', 'T234', 'T255')
      AND (f.raw->>'DESC_PRODUTO_EST' ILIKE '%ABATE%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE '%ENGORDA%')
      AND coalesce(f.raw->>'STATUS', '') <> 'C'
      -- ±3 dias para achar a contra-nota T231 vizinha da nota T255
      AND f.raw->>'DATA_MOVTO' >= (p_de - 3)::text AND f.raw->>'DATA_MOVTO' < (p_ate + 4)::text
  ),
  cn AS MATERIALIZED (SELECT DISTINCT cf, dt FROM base WHERE tmv = 'T231'),
  -- carcaça média das contra-notas do período (fallback 230 kg) para estimar cabeças da nota PJ sem QTDE_AUX coerente
  cm AS (SELECT coalesce(sum(qpri) / nullif(sum(qaux), 0), 230) AS kg_cab
         FROM base WHERE tmv = 'T231' AND raw->>'DESC_PRODUTO_EST' ILIKE '%ABATE%' AND qpri > 0 AND qaux > 0),
  it AS (
    SELECT b.*, b.tmv = 'T255' AS pj,
           b.tmv = 'T255' AND NOT (b.qaux > 0 AND b.qpri / b.qaux BETWEEN 120 AND 450) AS est
    FROM base b
    WHERE b.dt BETWEEN p_de AND p_ate
      AND (b.tmv IN ('T231', 'T234')
           OR (b.tmv = 'T255' AND b.raw->>'DESC_PRODUTO_EST' ILIKE '%ABATE%'
               AND b.qpri > 10                                   -- linha de ajuste de valor fica fora
               AND NOT EXISTS (SELECT 1 FROM cn WHERE cn.cf = b.cf AND cn.dt BETWEEN b.dt - 3 AND b.dt + 3)))
  )
  SELECT 'atak'::text,
    it.dt,
    concat_ws('|', it.tmv, it.raw->>'NUM_DOCTO', it.raw->>'SERIE_SEQ'),
    it.cf,
    left(initcap(trim(coalesce(nullif(it.raw->>'APELIDO', ''), it.raw->>'NOME_CADASTRO'))), 40),
    coalesce(nullif(initcap(trim(it.raw->>'CIDADE')), ''), 'Sem cidade'),
    coalesce(nullif(upper(trim(it.raw->>'UF')), ''), 'Sem UF'),
    CASE WHEN it.raw->>'DESC_PRODUTO_EST' ILIKE '%ENGORDA%' THEN 'reposicao' ELSE 'abate' END,
    initcap(trim(it.raw->>'DESC_PRODUTO_EST')),
    CASE WHEN it.raw->>'DESC_PRODUTO_EST' ILIKE 'FEMEA%' OR it.raw->>'DESC_PRODUTO_EST' ILIKE 'VACA%' THEN 'F'
         WHEN it.raw->>'DESC_PRODUTO_EST' ILIKE 'MACHO%' OR it.raw->>'DESC_PRODUTO_EST' ILIKE 'BOI%' THEN 'M' END,
    it.raw->>'DESC_PRODUTO_EST' ILIKE '%NOTA 10%',
    CASE WHEN it.est THEN greatest(1, round(it.qpri / cm.kg_cab)) ELSE it.qaux END,
    CASE WHEN it.raw->>'DESC_PRODUTO_EST' ILIKE '%ENGORDA%' THEN 0 ELSE it.qpri END,
    coalesce((it.raw->>'VALOR_LIQUIDO_ITEM')::numeric, 0),
    (it.raw->>'PRAZO_MEDIO')::numeric,
    nullif(trim(it.raw->>'DESC_COND_PGTO'), ''),
    coalesce(nullif(left(initcap(trim(it.raw->>'NOME_TRANSPORTADOR')), 40), ''), 'Sem transportador'),
    it.pj,
    it.est
  FROM it CROSS JOIN cm
$fn$;

REVOKE ALL ON FUNCTION public.fn_ind_compra_gado_item(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ── (c) Porta: compra × abate em dias fechados, diferença em parcelas ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_compra_gado_painel(p_company_id uuid, p_dt_ini date DEFAULT NULL, p_dt_fim date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text; v_ate date; v_de date; v_dias int; v_ini_mes date; v_out jsonb;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; v_fech date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  -- Preço do gado e produtores: mesma regra do BI da Planta (só direção).
  SELECT uc.role INTO v_role FROM user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = v_uid LIMIT 1;
  IF NOT (public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id)
          OR v_role IN ('owner','socio','acesso_total','adm','admin','diretor','diretor_area','gerente')
          OR EXISTS (SELECT 1 FROM user_scope us WHERE us.user_id = v_uid AND us.company_id = p_company_id AND us.ativo
                       AND 'TODOS' = ANY(us.dominios))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_compra_gado',
      'mensagem', 'O BI de Compra de Animais mostra preço pago e produtores e é restrito à direção. Peça acesso ao administrador.');
  END IF;

  v_ate := coalesce(p_dt_fim, current_date);
  v_de := coalesce(p_dt_ini, date_trunc('month', v_ate)::date);
  IF v_de > v_ate THEN v_de := v_ate; END IF;
  v_dias := v_ate - v_de + 1;
  v_ini_mes := (date_trunc('month', v_ate) - interval '14 months')::date;
  -- Compra × abate só compara DIAS FECHADOS: a nota de compra sai depois do abate (RD-38 54cda9a1: 27/11 com 12
  -- abatidos e 0 notas). Período que termina antes de hoje = inteiro fechado.
  v_fech := least(v_ate, v_hoje - 1);

  WITH cp AS (SELECT * FROM fn_ind_compra_gado_item(p_company_id, least(v_de - v_dias, v_ini_mes), v_ate)),
  c1 AS (SELECT * FROM cp WHERE dia BETWEEN v_de AND v_ate),
  c0 AS (SELECT * FROM cp WHERE dia BETWEEN v_de - v_dias AND v_de - 1),
  ab AS (SELECT * FROM c1 WHERE finalidade = 'abate'),
  abf AS (SELECT * FROM ab WHERE dia <= v_fech),
  a1 AS (SELECT * FROM fn_ind_abate_animal(p_company_id, v_de, v_ate)),
  pr AS (SELECT produtor_cod, max(produtor) AS produtor, max(cidade) AS cidade, max(uf) AS uf,
                sum(cabecas) AS cab, sum(kg) AS kg, sum(valor) AS valor, count(DISTINCT documento) AS notas,
                sum(prazo_dias * valor) / nullif(sum(valor) FILTER (WHERE prazo_dias IS NOT NULL), 0) AS prazo,
                bool_or(nota10) AS nota10, max(dia) AS ult
         FROM c1 GROUP BY produtor_cod),
  prr AS (SELECT *, row_number() OVER (ORDER BY valor DESC) AS r, sum(valor) OVER () AS tot FROM pr),
  canc AS (SELECT * FROM fn_ind_compra_gado_cancelada(p_company_id, v_de, v_ate))
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'dias', v_dias),
    'resumo', (SELECT jsonb_build_object(
        'cabecas', round(coalesce(sum(cabecas), 0)), 'valor', round(coalesce(sum(valor), 0), 2),
        'kg', round(coalesce(sum(kg), 0)), 'arrobas', round(coalesce(sum(kg), 0) / 15, 1),
        'rs_arroba', round(15 * sum(valor) FILTER (WHERE finalidade = 'abate' AND kg > 0) / nullif(sum(kg) FILTER (WHERE finalidade = 'abate'), 0), 2),
        'rs_kg', round(sum(valor) FILTER (WHERE finalidade = 'abate' AND kg > 0) / nullif(sum(kg) FILTER (WHERE finalidade = 'abate'), 0), 2),
        'custo_cab', round(sum(valor) / nullif(sum(cabecas), 0), 0),
        'carcaca_media', round(sum(kg) FILTER (WHERE finalidade = 'abate') / nullif(sum(cabecas) FILTER (WHERE finalidade = 'abate' AND kg > 0), 0), 1),
        'produtores', count(DISTINCT produtor_cod), 'notas', count(DISTINCT documento),
        'cidades', count(DISTINCT cidade), 'dias_compra', count(DISTINCT dia),
        'prazo_medio', round(sum(prazo_dias * valor) / nullif(sum(valor) FILTER (WHERE prazo_dias IS NOT NULL), 0), 1),
        'reposicao_cab', round(coalesce(sum(cabecas) FILTER (WHERE finalidade = 'reposicao'), 0)),
        'reposicao_valor', round(coalesce(sum(valor) FILTER (WHERE finalidade = 'reposicao'), 0), 2),
        'femeas_pct', round(100 * sum(cabecas) FILTER (WHERE sexo = 'F') / nullif(sum(cabecas), 0), 1),
        'nota10_pct', round(100 * sum(cabecas) FILTER (WHERE nota10) / nullif(sum(cabecas), 0), 1)) FROM c1),
    'anterior', (SELECT jsonb_build_object(
        'de', v_de - v_dias, 'ate', v_de - 1,
        'cabecas', round(coalesce(sum(cabecas), 0)), 'valor', round(coalesce(sum(valor), 0), 2),
        'arrobas', round(coalesce(sum(kg), 0) / 15, 1),
        'rs_arroba', round(15 * sum(valor) FILTER (WHERE finalidade = 'abate' AND kg > 0) / nullif(sum(kg) FILTER (WHERE finalidade = 'abate'), 0), 2),
        'custo_cab', round(sum(valor) / nullif(sum(cabecas), 0), 0),
        'produtores', count(DISTINCT produtor_cod),
        'prazo_medio', round(sum(prazo_dias * valor) / nullif(sum(valor) FILTER (WHERE prazo_dias IS NOT NULL), 0), 1)) FROM c0),
    'concentracao', (SELECT jsonb_build_object(
        'top5_pct', round(100 * sum(valor) FILTER (WHERE r <= 5) / nullif(max(tot), 0), 1),
        'top10_pct', round(100 * sum(valor) FILTER (WHERE r <= 10) / nullif(max(tot), 0), 1),
        'top15_pct', round(100 * sum(valor) FILTER (WHERE r <= 15) / nullif(max(tot), 0), 1),
        'maior_pct', round(100 * max(valor) / nullif(max(tot), 0), 1),
        'produtores_80pct', (SELECT count(*) FROM (SELECT sum(valor) OVER (ORDER BY valor DESC ROWS UNBOUNDED PRECEDING) - valor AS antes, tot FROM prr) z WHERE antes < 0.8 * tot)) FROM prr),
    'meses', (SELECT coalesce(jsonb_agg(jsonb_build_object('mes', m.mes, 'cab', coalesce(x.cab, 0), 'valor', coalesce(x.valor, 0),
                     'arrobas', coalesce(x.arrobas, 0), 'rs_arroba', x.arroba, 'prazo', x.prazo, 'produtores', coalesce(x.pr, 0)) ORDER BY m.mes), '[]'::jsonb)
            FROM (SELECT to_char(g, 'YYYY-MM') AS mes FROM generate_series(v_ini_mes, v_ate, interval '1 month') g) m
            LEFT JOIN (SELECT to_char(dia, 'YYYY-MM') AS mes, round(sum(cabecas)) AS cab, round(sum(valor), 2) AS valor, round(sum(kg) / 15, 1) AS arrobas,
                              round(15 * sum(valor) FILTER (WHERE finalidade = 'abate' AND kg > 0) / nullif(sum(kg) FILTER (WHERE finalidade = 'abate'), 0), 2) AS arroba,
                              round(sum(prazo_dias * valor) / nullif(sum(valor) FILTER (WHERE prazo_dias IS NOT NULL), 0), 1) AS prazo,
                              count(DISTINCT produtor_cod) AS pr
                       FROM cp WHERE dia >= v_ini_mes GROUP BY 1) x USING (mes)),
    'semanas', (SELECT coalesce(jsonb_agg(jsonb_build_object('semana', s, 'cab', cab, 'arrobas', arr, 'rs_arroba', arroba) ORDER BY s), '[]'::jsonb)
            FROM (SELECT date_trunc('week', dia)::date AS s, round(sum(cabecas)) AS cab, round(sum(kg) / 15, 1) AS arr,
                         round(15 * sum(valor) FILTER (WHERE kg > 0) / nullif(sum(kg), 0), 2) AS arroba
                  FROM ab GROUP BY 1) w),
    'produtores', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', produtor_cod, 'produtor', produtor, 'cidade', cidade, 'uf', uf,
                     'cab', round(cab), 'arrobas', round(kg / 15, 1), 'valor', round(valor, 2), 'notas', notas,
                     'rs_arroba', round(15 * valor / nullif(kg, 0), 2), 'carcaca_media', round(kg / nullif(cab, 0), 1),
                     'prazo', round(prazo, 1), 'nota10', nota10, 'ult_compra', ult,
                     'participacao', round(100 * valor / nullif(tot, 0), 1)) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT * FROM prr WHERE r <= 15) x),
    'cidades', (SELECT coalesce(jsonb_agg(jsonb_build_object('cidade', cidade, 'uf', uf, 'produtores', npr, 'cab', cab, 'valor', valor,
                     'rs_arroba', arroba, 'participacao', part) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT cidade, max(uf) AS uf, count(DISTINCT produtor_cod) AS npr, round(sum(cabecas)) AS cab, round(sum(valor), 2) AS valor,
                         round(15 * sum(valor) FILTER (WHERE finalidade = 'abate' AND kg > 0) / nullif(sum(kg) FILTER (WHERE finalidade = 'abate'), 0), 2) AS arroba,
                         round(100 * sum(valor) / nullif(sum(sum(valor)) OVER (), 0), 1) AS part
                  FROM c1 GROUP BY cidade ORDER BY sum(valor) DESC LIMIT 15) x),
    'ufs', (SELECT coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'produtores', npr, 'cab', cab, 'valor', valor, 'rs_arroba', arroba) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT uf, count(DISTINCT produtor_cod) AS npr, round(sum(cabecas)) AS cab, round(sum(valor), 2) AS valor,
                         round(15 * sum(valor) FILTER (WHERE finalidade = 'abate' AND kg > 0) / nullif(sum(kg) FILTER (WHERE finalidade = 'abate'), 0), 2) AS arroba
                  FROM c1 GROUP BY uf) x),
    'categorias', (SELECT coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'sexo', sexo, 'finalidade', finalidade, 'nota10', nota10,
                     'cab', cab, 'arrobas', arr, 'valor', valor, 'rs_arroba', arroba, 'custo_cab', round(valor / nullif(cab, 0), 0),
                     'carcaca_media', round(kg / nullif(cab, 0), 1)) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT categoria, max(sexo) AS sexo, max(finalidade) AS finalidade, bool_or(nota10) AS nota10,
                         round(sum(cabecas)) AS cab, sum(kg) AS kg, round(sum(kg) / 15, 1) AS arr, round(sum(valor), 2) AS valor,
                         round(15 * sum(valor) FILTER (WHERE kg > 0) / nullif(sum(kg), 0), 2) AS arroba
                  FROM c1 GROUP BY categoria) x),
    'sexo', (SELECT coalesce(jsonb_agg(jsonb_build_object('sexo', coalesce(sexo, '?'), 'cab', cab, 'valor', valor, 'rs_arroba', arroba, 'carcaca_media', cm) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT sexo, round(sum(cabecas)) AS cab, round(sum(valor), 2) AS valor,
                         round(15 * sum(valor) FILTER (WHERE kg > 0) / nullif(sum(kg), 0), 2) AS arroba,
                         round(sum(kg) / nullif(sum(cabecas) FILTER (WHERE kg > 0), 0), 1) AS cm
                  FROM ab GROUP BY sexo) x),
    'transportadores', (SELECT coalesce(jsonb_agg(jsonb_build_object('transportador', transportador, 'cab', cab, 'notas', notas, 'valor', valor,
                     'participacao', part) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT transportador, round(sum(cabecas)) AS cab, count(DISTINCT documento) AS notas, round(sum(valor), 2) AS valor,
                         round(100 * sum(valor) / nullif(sum(sum(valor)) OVER (), 0), 1) AS part
                  FROM c1 GROUP BY transportador ORDER BY sum(valor) DESC LIMIT 10) x),
    'prazos', (SELECT coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'ordem', ordem, 'notas', notas, 'valor', valor,
                     'participacao', part) ORDER BY ordem), '[]'::jsonb)
            FROM (SELECT CASE WHEN prazo_dias IS NULL THEN 'Sem prazo' WHEN prazo_dias <= 0 THEN 'À vista'
                              WHEN prazo_dias <= 7 THEN '1 a 7 dias' WHEN prazo_dias <= 15 THEN '8 a 15 dias'
                              WHEN prazo_dias <= 30 THEN '16 a 30 dias' ELSE 'Mais de 30 dias' END AS faixa,
                         CASE WHEN prazo_dias IS NULL THEN 9 WHEN prazo_dias <= 0 THEN 1 WHEN prazo_dias <= 7 THEN 2
                              WHEN prazo_dias <= 15 THEN 3 WHEN prazo_dias <= 30 THEN 4 ELSE 5 END AS ordem,
                         count(DISTINCT documento) AS notas, round(sum(valor), 2) AS valor,
                         round(100 * sum(valor) / nullif(sum(sum(valor)) OVER (), 0), 1) AS part
                  FROM c1 GROUP BY 1, 2) x),
    'abate', (SELECT jsonb_build_object(
        'fechado_ate', CASE WHEN v_fech >= v_de THEN v_fech END,
        'cabecas', count(*) FILTER (WHERE dia <= v_fech),
        'proprias', count(*) FILTER (WHERE dia <= v_fech AND NOT terceiro),
        'terceiros', count(*) FILTER (WHERE dia <= v_fech AND terceiro),
        'carcaca_kg', round(sum(peso) FILTER (WHERE dia <= v_fech AND NOT terceiro)),
        'carcaca_media', round(avg(nullif(peso, 0)) FILTER (WHERE dia <= v_fech AND NOT terceiro), 1),
        'compra_abate_cab', (SELECT round(coalesce(sum(cabecas), 0)) FROM abf),
        'compra_abate_valor', (SELECT round(coalesce(sum(valor), 0), 2) FROM abf),
        'custo_por_cab_abatida', round((SELECT sum(valor) FROM abf) / nullif(count(*) FILTER (WHERE dia <= v_fech AND NOT terceiro), 0), 0),
        'custo_por_kg_carcaca_abatida', round((SELECT sum(valor) FROM abf) / nullif(sum(peso) FILTER (WHERE dia <= v_fech AND NOT terceiro), 0), 2),
        'saldo_cab', (SELECT round(coalesce(sum(cabecas), 0)) FROM abf) - count(*) FILTER (WHERE dia <= v_fech AND NOT terceiro),
        -- parcelas da diferença (card Compra × abate, "?" em cada uma)
        'compra_pj_cab', (SELECT round(coalesce(sum(cabecas), 0)) FROM abf WHERE compra_pj),
        'compra_pj_kg', (SELECT round(coalesce(sum(kg), 0)) FROM abf WHERE compra_pj),
        'compra_pj_estimada', (SELECT coalesce(bool_or(cabecas_estimadas), false) FROM abf WHERE compra_pj),
        'abate_hoje_proprias', count(*) FILTER (WHERE dia > v_fech AND NOT terceiro),
        'compra_hoje_cab', (SELECT round(coalesce(sum(cabecas), 0)) FROM ab WHERE dia > v_fech),
        'notas_pendentes_cab', greatest(count(*) FILTER (WHERE dia > v_fech AND NOT terceiro)
                                        - (SELECT round(coalesce(sum(cabecas), 0)) FROM ab WHERE dia > v_fech), 0),
        'sem_nota_cab', greatest(count(*) FILTER (WHERE dia <= v_fech AND NOT terceiro) - (SELECT round(coalesce(sum(cabecas), 0)) FROM abf), 0)) FROM a1),
    'canceladas', (SELECT jsonb_build_object('linhas', linhas, 'cabecas', round(cabecas), 'valor', round(valor, 2)) FROM canc)
  ) INTO v_out;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_bi_compra_gado_painel(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_compra_gado_painel(uuid, date, date) TO authenticated;

-- ── "?" (RD-95) do card e de cada parcela ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI Compra de Animais', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/inteligencia/recepcao', 'industria', 'publicado'
FROM (VALUES
 ('compra.abate', 'Compra × abate', 'Indicador calculado.', 'Cruza o gado comprado para abate com as cabeças abatidas pela planta, só nos dias já fechados (até ontem): a nota de compra sai depois do abate, então o dia de hoje fica fora da conta. Cada animal conta uma vez, mesmo com duas linhas de produto no romaneio.', 'Até 26/11: 1.142 compradas × 1.220 abatidas = −78.', 'Esperar saldo zero: o gado comprado no fim do período é abatido no seguinte.', 16),
 ('compra.abate_hoje', 'Notas ainda não emitidas', 'Nada a preencher.', 'Cabeças próprias abatidas hoje que ainda não têm nota de compra. A nota sai depois do abate; por isso o dia de hoje não entra na diferença.', 'Hoje: 25 abatidas, 0 notas.', 'Somar na diferença: amanhã, com a nota emitida, elas já estão na conta.', 22),
 ('compra.abate_pj', 'Compra de pessoa jurídica', 'Nada a preencher.', 'Gado para abate comprado de empresa (nota de entrada do fornecedor PJ). Já está somado nas compradas. A nota que o produtor rural emite sobre um lote que já tem contra-nota não entra de novo. Quando a nota não traz cabeças coerentes com o peso, as cabeças são estimadas pelo peso ÷ carcaça média.', 'Fazenda Três Curvas Ltda: 16 cabeças, 3.514 kg.', 'Contar a nota do produtor como compra nova: é o mesmo lote da contra-nota.', 23),
 ('compra.abate_sem_nota', 'Sem nota de compra', 'Nada a preencher.', 'Cabeças próprias abatidas nos dias fechados sem nota de compra para abate no período: gado comprado antes do período, gado próprio ou de sócio, ou nota lançada com atraso no ERP de origem.', '78 cabeças (cerca de 6% do abate).', 'Ler como perda de animal: é falta de nota no período, não de gado.', 24)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum;
