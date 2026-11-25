-- BI Compra de Animais (Indústria · Spec BIs Indústria 25/11/2026, seção "BI Compra de Animais").
-- Molde do BI Comercial em 3 camadas:
--   (1) tradutor por ramo  fn_ind_compra_gado_item  — lê o bruto do ERP de origem e normaliza (ATAK hoje; outro ERP
--       entra por UNION ALL no mesmo tradutor; nada fixo por empresa);
--   (2) porta genérica     fn_bi_compra_gado_painel — uma RPC, SECURITY DEFINER, guarda de empresa + direção, REVOKE anon;
--   (3) tela               /dashboard/inteligencia/recepcao (slot ind_painel_recepcao já no menu).
-- Fronteira: BI só LÊ o dado do ERP de origem; não grava nele nem recria contas/DRE/fiscal.
--
-- Por que um tradutor novo e não só o fn_ind_compra_gado (BI da Planta):
--   • o BI de compra precisa de UF, transportador, prazo de pagamento, documento e finalidade (abate × reposição),
--     que o tradutor antigo não devolve (mudar o RETURNS dele exigiria DROP — fora do padrão aditivo);
--   • RD-38 (prova no dado, 25/11): o domínio compra_gado traz contra-notas CANCELADAS (STATUS = 'C': 322 linhas,
--     R$ 9,8 mi na Frioeste) com valor cheio. O tradutor antigo soma essas linhas (nov/2025: arroba de R$ 681 com
--     canceladas × R$ 301,51 sem). Aqui elas ficam FORA. O BI da Planta segue com o tradutor antigo até a correção dele
--     (achado registrado na PR).
-- Filtro do gado vivo (spec): COD_TIPO_MV T231 (compra para abate) e T234 (compra para engorda/reposição), só produto
-- de animal (ABATE/ENGORDA — p.ex. LENHA lançada no T231 fica fora). O resto do export amplo (F621, T120, T130… cortes,
-- com valor zero ou de outros insumos) nunca entra.
-- kg = QTDE_PRI = kg de CARCAÇA pago ao produtor (arroba = 15 kg). Na reposição (T234) o kg não é carcaça: não entra na
-- arroba. Datas ISO (left(...,10)::date) e valores com ponto (::numeric).
-- LGPD: devolve nome do produtor (já exibido à direção no BI da Planta) e NUNCA o CPF/CNPJ; a porta é restrita à direção.

-- ── (1) Tradutor ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ind_compra_gado_item(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE (origem text, dia date, documento text, produtor_cod text, produtor text, cidade text, uf text,
               finalidade text, categoria text, sexo text, nota10 boolean, cabecas numeric, kg numeric, valor numeric,
               prazo_dias numeric, cond_pgto text, transportador text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  -- Ramo ATAK (importação ind_atak_fato, domínio compra_gado). Outro ERP: novo SELECT com as mesmas colunas, UNION ALL.
  SELECT 'atak'::text,
    left(f.raw->>'DATA_MOVTO', 10)::date,
    concat_ws('|', f.raw->>'COD_TIPO_MV', f.raw->>'NUM_DOCTO', f.raw->>'SERIE_SEQ'),
    trim(f.raw->>'COD_CLI_FOR'),
    left(initcap(trim(coalesce(nullif(f.raw->>'APELIDO', ''), f.raw->>'NOME_CADASTRO'))), 40),
    coalesce(nullif(initcap(trim(f.raw->>'CIDADE')), ''), 'Sem cidade'),
    coalesce(nullif(upper(trim(f.raw->>'UF')), ''), 'Sem UF'),
    CASE WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE '%ENGORDA%' THEN 'reposicao' ELSE 'abate' END,
    initcap(trim(f.raw->>'DESC_PRODUTO_EST')),
    CASE WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE 'FEMEA%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE 'VACA%' THEN 'F'
         WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE 'MACHO%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE 'BOI%' THEN 'M' END,
    f.raw->>'DESC_PRODUTO_EST' ILIKE '%NOTA 10%',
    coalesce((f.raw->>'QTDE_AUX')::numeric, 0),
    CASE WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE '%ENGORDA%' THEN 0 ELSE coalesce((f.raw->>'QTDE_PRI')::numeric, 0) END,
    coalesce((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric, 0),
    (f.raw->>'PRAZO_MEDIO')::numeric,
    nullif(trim(f.raw->>'DESC_COND_PGTO'), ''),
    coalesce(nullif(left(initcap(trim(f.raw->>'NOME_TRANSPORTADOR')), 40), ''), 'Sem transportador')
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id AND f.dominio = 'compra_gado'
    -- guarda de empresa (multi-tenant): SECURITY DEFINER ignora RLS e o UUID da empresa não é segredo.
    AND (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
    AND f.raw->>'COD_TIPO_MV' IN ('T231', 'T234')
    AND (f.raw->>'DESC_PRODUTO_EST' ILIKE '%ABATE%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE '%ENGORDA%')
    AND coalesce(f.raw->>'STATUS', '') <> 'C'
    AND f.raw->>'DATA_MOVTO' >= p_de::text AND f.raw->>'DATA_MOVTO' < (p_ate + 1)::text
$fn$;

REVOKE ALL ON FUNCTION public.fn_ind_compra_gado_item(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- Transparência (RD-51): quanto do período ficou FORA por nota cancelada no ERP de origem.
CREATE OR REPLACE FUNCTION public.fn_ind_compra_gado_cancelada(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE (linhas bigint, cabecas numeric, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT count(*), coalesce(sum((f.raw->>'QTDE_AUX')::numeric), 0), coalesce(sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric), 0)
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id AND f.dominio = 'compra_gado'
    AND (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
    AND f.raw->>'COD_TIPO_MV' IN ('T231', 'T234')
    AND (f.raw->>'DESC_PRODUTO_EST' ILIKE '%ABATE%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE '%ENGORDA%')
    AND f.raw->>'STATUS' = 'C'
    AND f.raw->>'DATA_MOVTO' >= p_de::text AND f.raw->>'DATA_MOVTO' < (p_ate + 1)::text
$fn$;

REVOKE ALL ON FUNCTION public.fn_ind_compra_gado_cancelada(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ── (2) Porta ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_compra_gado_painel(p_company_id uuid, p_dt_ini date DEFAULT NULL, p_dt_fim date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text; v_ate date; v_de date; v_dias int; v_ini_mes date; v_out jsonb;
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

  WITH cp AS (SELECT * FROM fn_ind_compra_gado_item(p_company_id, least(v_de - v_dias, v_ini_mes), v_ate)),
  c1 AS (SELECT * FROM cp WHERE dia BETWEEN v_de AND v_ate),
  c0 AS (SELECT * FROM cp WHERE dia BETWEEN v_de - v_dias AND v_de - 1),
  ab AS (SELECT * FROM c1 WHERE finalidade = 'abate'),
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
        'cabecas', count(*), 'proprias', count(*) FILTER (WHERE NOT terceiro), 'terceiros', count(*) FILTER (WHERE terceiro),
        'carcaca_kg', round(sum(peso) FILTER (WHERE NOT terceiro)),
        'carcaca_media', round(avg(nullif(peso, 0)) FILTER (WHERE NOT terceiro), 1),
        'compra_abate_cab', (SELECT round(coalesce(sum(cabecas), 0)) FROM ab),
        'compra_abate_valor', (SELECT round(coalesce(sum(valor), 0), 2) FROM ab),
        'custo_por_cab_abatida', round((SELECT sum(valor) FROM ab) / nullif(count(*) FILTER (WHERE NOT terceiro), 0), 0),
        'custo_por_kg_carcaca_abatida', round((SELECT sum(valor) FROM ab) / nullif(sum(peso) FILTER (WHERE NOT terceiro), 0), 2),
        'saldo_cab', (SELECT round(coalesce(sum(cabecas), 0)) FROM ab) - count(*) FILTER (WHERE NOT terceiro)) FROM a1),
    'canceladas', (SELECT jsonb_build_object('linhas', linhas, 'cabecas', round(cabecas), 'valor', round(valor, 2)) FROM canc)
  ) INTO v_out;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_bi_compra_gado_painel(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_compra_gado_painel(uuid, date, date) TO authenticated;

-- ── (3) Tela no menu (slot ind_painel_recepcao já existe em module_catalog) + "?" RD-95 ──────────────────────────────
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, componentes_principais, features_relacionadas, views_consumidas)
VALUES ('industrial_bi_compra_animais', '/dashboard/inteligencia/recepcao', 'industria', 'ind_painel_recepcao', 'BI Compra de Animais',
  'Compra de gado vivo: arrobas e R$/@ por período, evolução do preço, produtores (top 15), região, categoria e sexo, transportador, prazo de pagamento, concentração e cruzamento com o abate. Genérico por ERP de origem; só leitura.',
  'parcial', 'alta', ARRAY['fn_bi_compra_gado_painel']::text[], ARRAY['BiCompraAnimais']::text[], ARRAY[]::text[], ARRAY['ind_atak_fato']::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI Compra de Animais', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/inteligencia/recepcao', 'industria', 'publicado'
FROM (VALUES
 ('compra.periodo', 'Período', 'Escolha o intervalo de datas da compra.', 'Todos os números usam a data da contra-nota; a comparação é com o período anterior de mesmo tamanho.', '"Este mês" compara com os mesmos dias do mês passado.', 'Comparar mês fechado com mês pela metade.', 1),
 ('compra.leituras', 'Leituras para a decisão', 'Nada a preencher.', 'Frases calculadas dos números do período: preço da arroba, concentração, prazo e cruzamento com o abate.', '"A arroba subiu 4,2% contra o período anterior".', 'Ler como regra fixa: as frases mudam com o período.', 2),
 ('compra.arrobas', 'Arrobas compradas', 'Indicador calculado.', 'Kg de carcaça pagos aos produtores do gado para abate, divididos por 15.', '22.400 @ no mês.', 'Confundir com peso vivo: aqui é carcaça.', 3),
 ('compra.rs_arroba', 'Preço da arroba (R$/@)', 'Indicador calculado.', 'Valor pago pelo gado para abate dividido pelas arrobas de carcaça. Reposição (engorda) fica fora: é paga por cabeça.', 'R$ 335,00 por arroba.', 'Comparar com a arroba de outra praça sem considerar frete e prêmios.', 4),
 ('compra.valor', 'Valor comprado', 'Indicador calculado.', 'Total das contra-notas de compra de gado vivo (abate e reposição), sem as notas canceladas.', 'R$ 7,2 milhões.', 'Somar com o financeiro: aqui é o valor da compra, não o pagamento.', 5),
 ('compra.cabecas', 'Cabeças compradas', 'Indicador calculado.', 'Animais nas contra-notas de compra de gado vivo no período.', '1.317 cabeças.', 'Esperar bater com o abate no mesmo dia: o gado chega antes.', 6),
 ('compra.custo_cab', 'Custo por cabeça', 'Indicador calculado.', 'Valor comprado dividido pelas cabeças compradas.', 'R$ 5.500 por cabeça.', 'Esquecer que fêmea pesa e custa menos por cabeça.', 7),
 ('compra.prazo', 'Prazo médio de pagamento', 'Indicador calculado.', 'Prazo da condição de pagamento de cada nota, ponderado pelo valor. Mostra em quantos dias, em média, a compra vira pagamento.', '6,3 dias.', 'Ler como dias de atraso: é o combinado na compra.', 8),
 ('compra.concentracao', 'Concentração nos maiores', 'Indicador calculado.', 'Parte do valor comprado que veio dos 5, 10 e 15 maiores produtores, e quantos produtores fazem 80% da compra.', 'Top 10 = 18% da compra.', 'Ler concentração baixa como problema: base pulverizada reduz risco de oferta.', 9),
 ('compra.evolucao', 'Evolução do preço do boi', 'Nada a preencher.', 'Preço da arroba mês a mês (15 meses) e semana a semana no período.', 'Outubro R$ 348,70 → novembro R$ 335,01.', 'Comparar mês corrente parcial com mês fechado.', 10),
 ('compra.produtores', 'Produtores (top 15)', 'Nada a preencher.', 'Os 15 produtores de quem mais se comprou no período, com cabeças, arrobas, R$/@, carcaça média, prazo e participação.', 'Produtor X: 48 cabeças, R$ 336/@.', 'Comparar R$/@ de Nota 10 com comum: o Nota 10 recebe prêmio.', 11),
 ('compra.regiao', 'Região de origem', 'Nada a preencher.', 'Cidades e estados de origem do gado, com produtores, cabeças, valor e R$/@.', 'Itapiranga/SC: 12% da compra.', 'Somar cidades de mesmo nome em estados diferentes.', 12),
 ('compra.categoria', 'Categoria e sexo', 'Nada a preencher.', 'Compra por categoria do animal (macho, fêmea, Nota 10, precoce, reposição) e por sexo.', 'Fêmea para abate: 55% das cabeças.', 'Comparar R$/@ da reposição: ela é paga por cabeça.', 13),
 ('compra.transportador', 'Transportador', 'Nada a preencher.', 'Quem fez o frete do gado, com notas, cabeças e valor transportado.', 'Frota própria: 98% das notas.', 'Ler como custo de frete: aqui é o valor do gado transportado.', 14),
 ('compra.prazos', 'Prazos de pagamento', 'Nada a preencher.', 'Distribuição do valor comprado pelas faixas de prazo da condição de pagamento.', '1 a 7 dias: 97% do valor.', 'Confundir com vencidos: é o prazo combinado.', 15),
 ('compra.abate', 'Compra × abate', 'Indicador calculado.', 'Cruza o gado comprado para abate com as cabeças abatidas pela planta no mesmo período: custo do boi por cabeça abatida e por kg de carcaça abatida.', 'R$ 5.480 por cabeça abatida.', 'Esperar saldo zero: o gado comprado no fim do período é abatido no seguinte.', 16),
 ('compra.prod_produtor', 'Produtor', 'Nada a preencher.', 'Nome do produtor com contra-nota no período (o CPF/CNPJ não é mostrado). O selo Nota 10 indica que vendeu gado Nota 10.', 'João da Silva · Nota 10.', 'Confundir o produtor com a cidade dele.', 18),
 ('compra.prod_cidade', 'Cidade do produtor', 'Nada a preencher.', 'Município e estado de origem do produtor naquela linha.', 'Guaraciaba/SC.', 'Somar cidades diferentes do mesmo produtor como se fosse uma só.', 19),
 ('compra.prod_carcaca', 'Carcaça média do produtor', 'Indicador calculado.', 'Kg de carcaça pagos dividido pelas cabeças daquele produtor.', '236 kg.', 'Comparar produtor de boi com produtor de vaca sem olhar a categoria.', 20),
 ('compra.prod_ultima', 'Última compra', 'Nada a preencher.', 'Data da última contra-nota daquele produtor dentro do período.', '29/10.', 'Ler como a última compra da história: é só dentro do período.', 21),
 ('compra.canceladas', 'Notas canceladas fora', 'Nada a preencher.', 'Contra-notas canceladas no ERP de origem no período. Ficam fora de todos os números.', '3 notas, R$ 45 mil.', 'Somar de volta: nota cancelada não é compra.', 17)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
