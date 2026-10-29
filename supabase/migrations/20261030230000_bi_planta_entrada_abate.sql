-- BI da Planta · Onda 0 (fundação da coleta) + Onda 1 (Entrada do gado e abate) — CEO 29/10/2026 16:17
-- ("perfeito, pode criar as PR do BI da Planta"), proposta aprovada: https://claude.ai/artifact/QuR1ZgsS1ATkLTmy1yg4sS
--
-- GENÉRICO como o painel comercial: a tela lê só a porta fn_bi_planta_abate; os tradutores leem o dado bruto do ERP de
-- origem (ATAK hoje; TOTVS/outro = outro ramo UNION ALL no tradutor, a tela não muda). Nenhuma empresa fixa aqui.
--
-- Onda 0 — a produção e o abate do ATAK chegavam com chave = hash da linha (HASH_ROW). A visão de produção vem SOMADA
-- por hora: quando a soma muda no fim do dia, a linha nova ganha outro hash e a antiga fica (out/2026: 2.010 abates na
-- produção contra 1.392 animais reais). Passa a chave para o GRÃO natural da visão (provado único em 2.316 grupos de
-- 5 dias, 0 colisões); o upsert passa a sobrescrever. As linhas antigas não são apagadas: o tradutor fica com a versão
-- mais recente de cada grão. A desossa NÃO muda aqui (tem linhas legítimas com o mesmo grão — vai na onda 2).

-- ── Onda 0: chave natural (só onde ainda é hash; vale para qualquer empresa com ATAK) ─────────────────────────────
UPDATE public.atak_fonte_mapa
   SET chave_fato_sql = $k$CONCAT(COD_TIPO_MV,'|',CHAVE_FATO,'|',COD_PRODUTO,'|',COD_REF,'|',HORA_REGISTRO,'|',COD_CLI_FOR,'|',COD_LINHA)$k$
 WHERE dominio = 'producao_frigorifico' AND upper(trim(chave_fato_sql)) = 'HASH_ROW';

UPDATE public.atak_fonte_mapa
   SET chave_fato_sql = $k$CONCAT(COD_DOCTO,'|',NUM_DOCTO,'|',SERIE_SEQ,'|',SEQ_ABATE,'|',COD_PRODUTO)$k$
 WHERE dominio = 'miudos_5quarto' AND upper(trim(chave_fato_sql)) = 'HASH_ROW';

-- ── Tradutor: abate animal a animal ──────────────────────────────────────────────────────────────────────────────
-- ATAK: romaneio de abate (RAA = próprio, RAT = abate de terceiros). Uma linha por animal, versão mais recente.
CREATE OR REPLACE FUNCTION public.fn_ind_abate_animal(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE (origem text, dia date, animal text, categoria text, sexo text, classificacao text, peso numeric, terceiro boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT DISTINCT ON (f.raw->>'COD_DOCTO', f.raw->>'NUM_DOCTO', f.raw->>'SERIE_SEQ', f.raw->>'SEQ_ABATE', f.raw->>'COD_PRODUTO')
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
  ORDER BY f.raw->>'COD_DOCTO', f.raw->>'NUM_DOCTO', f.raw->>'SERIE_SEQ', f.raw->>'SEQ_ABATE', f.raw->>'COD_PRODUTO', f.imported_at DESC
$fn$;

-- ── Tradutor: compra de gado para abate ──────────────────────────────────────────────────────────────────────────
-- ATAK: contra-nota do produtor (T231/T234). Quantidade principal = kg de carcaça pagos; auxiliar = cabeças.
-- Gado de reposição ("PARA ENGORDA") fica fora: não é compra para abate.
CREATE OR REPLACE FUNCTION public.fn_ind_compra_gado(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE (origem text, dia date, produtor_cod text, produtor text, cidade text, categoria text, sexo text,
  nota10 boolean, cabecas numeric, kg numeric, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT 'atak'::text,
    left(f.raw->>'DATA_MOVTO', 10)::date,
    trim(f.raw->>'COD_CLI_FOR'),
    left(initcap(trim(coalesce(nullif(f.raw->>'APELIDO', ''), f.raw->>'NOME_CADASTRO'))), 40),
    coalesce(nullif(trim(f.raw->>'CIDADE'), ''), 'Sem cidade'),
    trim(f.raw->>'DESC_PRODUTO_EST'),
    CASE WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE 'FEMEA%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE 'VACA%' THEN 'F'
         WHEN f.raw->>'DESC_PRODUTO_EST' ILIKE 'MACHO%' OR f.raw->>'DESC_PRODUTO_EST' ILIKE 'BOI%' THEN 'M' END,
    f.raw->>'DESC_PRODUTO_EST' ILIKE '%NOTA 10%',
    coalesce((f.raw->>'QTDE_AUX')::numeric, 0),
    coalesce((f.raw->>'QTDE_PRI')::numeric, 0),
    coalesce((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric, 0)
  FROM public.ind_atak_fato f
  WHERE f.company_id = p_company_id AND f.dominio = 'compra_gado'
    AND f.raw->>'COD_TIPO_MV' IN ('T231', 'T234')
    AND f.raw->>'DESC_PRODUTO_EST' ILIKE '%ABATE%'
    AND f.raw->>'DATA_MOVTO' >= p_de::text AND f.raw->>'DATA_MOVTO' < (p_ate + 1)::text
$fn$;

-- ── Tradutor: horas do ponto por setor (sem nomes — LGPD) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ind_horas_setor(p_company_id uuid, p_de date, p_ate date)
RETURNS TABLE (setor text, pessoas bigint, horas numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT coalesce(nullif(trim(d.department), ''), 'Sem setor'), count(DISTINCT d.cpf), round(sum(d.worked_seconds) / 3600.0, 1)
  FROM public.ind_ponto_dia d
  WHERE d.company_id = p_company_id AND d.data BETWEEN p_de AND p_ate
  GROUP BY 1
$fn$;

REVOKE ALL ON FUNCTION public.fn_ind_abate_animal(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ind_compra_gado(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ind_horas_setor(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ── Porta única da tela ──────────────────────────────────────────────────────────────────────────────────────────
-- Quem vê: direção da empresa (owner, sócio, acesso total, adm, diretor, gerente) ou quem tem escopo TODOS na empresa.
-- Preço do boi é informação de direção: RH, operação e vendedor não veem.
CREATE OR REPLACE FUNCTION public.fn_bi_planta_abate(p_company_id uuid, p_sexo text DEFAULT NULL, p_cidade text DEFAULT NULL,
  p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text; v_ate date; v_de date; v_dias int; v_ini_mes date; v_sexo text; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  SELECT uc.role INTO v_role FROM user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = v_uid LIMIT 1;
  IF NOT (public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id)
          OR v_role IN ('owner','socio','acesso_total','adm','admin','diretor','diretor_area','gerente')
          OR EXISTS (SELECT 1 FROM user_scope us WHERE us.user_id = v_uid AND us.company_id = p_company_id AND us.ativo
                       AND 'TODOS' = ANY(us.dominios))) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_planta',
      'mensagem', 'O BI da Planta mostra preço do gado e resultado da planta e é restrito à direção. Peça acesso ao administrador.');
  END IF;

  v_ate := coalesce(p_ate, current_date);
  v_de := coalesce(p_de, date_trunc('month', v_ate)::date);
  IF v_de > v_ate THEN v_de := v_ate; END IF;
  v_dias := v_ate - v_de + 1;
  v_ini_mes := (date_trunc('month', v_ate) - interval '14 months')::date;
  v_sexo := CASE WHEN p_sexo IN ('F','M') THEN p_sexo END;

  WITH ab AS (SELECT * FROM fn_ind_abate_animal(p_company_id, least(v_de - v_dias, v_ini_mes), v_ate) a
              WHERE v_sexo IS NULL OR a.sexo = v_sexo),
  cp AS (SELECT * FROM fn_ind_compra_gado(p_company_id, least(v_de - v_dias, v_ini_mes), v_ate) c
         WHERE (v_sexo IS NULL OR c.sexo = v_sexo) AND (p_cidade IS NULL OR c.cidade = p_cidade)),
  a1 AS (SELECT * FROM ab WHERE dia BETWEEN v_de AND v_ate),
  a0 AS (SELECT * FROM ab WHERE dia BETWEEN v_de - v_dias AND v_de - 1),
  c1 AS (SELECT * FROM cp WHERE dia BETWEEN v_de AND v_ate),
  c0 AS (SELECT * FROM cp WHERE dia BETWEEN v_de - v_dias AND v_de - 1),
  hs AS (SELECT * FROM fn_ind_horas_setor(p_company_id, v_de, v_ate)),
  hab AS (SELECT coalesce(sum(horas), 0) AS h, coalesce(sum(pessoas), 0) AS p FROM hs WHERE setor ILIKE '%ABATE%')
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate, 'dias', v_dias),
    'filtro', jsonb_build_object('sexo', v_sexo, 'cidade', p_cidade),
    'cidades_opcoes', (SELECT coalesce(jsonb_agg(cidade ORDER BY v DESC), '[]'::jsonb)
                       FROM (SELECT cidade, sum(valor) v FROM cp WHERE dia >= v_de - 365 GROUP BY 1 ORDER BY 2 DESC LIMIT 40) x),
    'resumo', (SELECT jsonb_build_object(
        'cabecas', count(*), 'dias_abate', count(DISTINCT dia),
        'cab_dia', round(count(*)::numeric / nullif(count(DISTINCT dia), 0), 1),
        'carcaca_media', round(avg(nullif(peso, 0)), 1), 'carcaca_t', round(sum(peso) / 1000, 1),
        'femeas', count(*) FILTER (WHERE sexo = 'F'), 'terceiros', count(*) FILTER (WHERE terceiro),
        'min_dia', (SELECT min(n) FROM (SELECT count(*) n FROM a1 GROUP BY dia) z),
        'max_dia', (SELECT max(n) FROM (SELECT count(*) n FROM a1 GROUP BY dia) z)) FROM a1),
    'compra', (SELECT jsonb_build_object(
        'cabecas', round(sum(cabecas)), 'kg', round(sum(kg)), 'valor', round(sum(valor), 2),
        'produtores', count(DISTINCT produtor_cod),
        'rs_arroba', round(15 * sum(valor) / nullif(sum(kg), 0), 2),
        'custo_cab', round(sum(valor) / nullif(sum(cabecas), 0), 0),
        'nota10_cab', round(sum(cabecas) FILTER (WHERE nota10))) FROM c1),
    'anterior', jsonb_build_object(
        'de', v_de - v_dias, 'ate', v_de - 1,
        'cabecas', (SELECT count(*) FROM a0),
        'carcaca_media', (SELECT round(avg(nullif(peso, 0)), 1) FROM a0),
        'rs_arroba', (SELECT round(15 * sum(valor) / nullif(sum(kg), 0), 2) FROM c0)),
    'horas', jsonb_build_object('abate_h', (SELECT h FROM hab), 'abate_pessoas', (SELECT p FROM hab),
        'h_por_cabeca', round((SELECT h FROM hab) / nullif((SELECT count(*) FROM a1 WHERE NOT terceiro), 0), 2)),
    'dia', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'cab', n, 'femeas', f, 'peso', p) ORDER BY dia), '[]'::jsonb)
            FROM (SELECT dia, count(*) n, count(*) FILTER (WHERE sexo = 'F') f, round(avg(nullif(peso, 0)), 1) p FROM a1 GROUP BY dia) d),
    'meses', (SELECT coalesce(jsonb_agg(jsonb_build_object('mes', m.mes, 'cab', coalesce(a.n, 0), 'peso', a.p, 'rs_arroba', c.arroba) ORDER BY m.mes), '[]'::jsonb)
            FROM (SELECT to_char(g, 'YYYY-MM') mes FROM generate_series(v_ini_mes, v_ate, interval '1 month') g) m
            LEFT JOIN (SELECT to_char(dia, 'YYYY-MM') mes, count(*) n, round(avg(nullif(peso, 0)), 1) p FROM ab WHERE dia >= v_ini_mes GROUP BY 1) a USING (mes)
            LEFT JOIN (SELECT to_char(dia, 'YYYY-MM') mes, round(15 * sum(valor) / nullif(sum(kg), 0), 2) arroba FROM cp WHERE dia >= v_ini_mes GROUP BY 1) c USING (mes)),
    'categorias', (SELECT coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'cab', cab, 'kg', kg, 'valor', valor,
                     'rs_arroba', round(15 * valor / nullif(kg, 0), 2)) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT categoria, round(sum(cabecas)) cab, round(sum(kg)) kg, round(sum(valor), 2) valor FROM c1 GROUP BY 1) x),
    'cidades', (SELECT coalesce(jsonb_agg(jsonb_build_object('cidade', cidade, 'produtores', pr, 'cab', cab, 'valor', valor,
                     'rs_arroba', round(15 * valor / nullif(kg, 0), 2)) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT cidade, count(DISTINCT produtor_cod) pr, round(sum(cabecas)) cab, sum(kg) kg, round(sum(valor), 2) valor
                  FROM c1 GROUP BY 1 ORDER BY sum(valor) DESC LIMIT 12) x),
    'produtores', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', produtor_cod, 'produtor', produtor, 'cidade', cidade, 'cab', cab,
                     'kg', round(kg), 'valor', valor, 'rs_arroba', round(15 * valor / nullif(kg, 0), 2),
                     'carcaca_media', round(kg / nullif(cab, 0), 1)) ORDER BY valor DESC), '[]'::jsonb)
            FROM (SELECT produtor_cod, max(produtor) produtor, max(cidade) cidade, round(sum(cabecas)) cab, sum(kg) kg, round(sum(valor), 2) valor
                  FROM c1 GROUP BY 1 ORDER BY sum(valor) DESC LIMIT 15) x),
    'setores', (SELECT coalesce(jsonb_agg(jsonb_build_object('setor', setor, 'pessoas', pessoas, 'horas', horas) ORDER BY horas DESC), '[]'::jsonb)
            FROM (SELECT * FROM hs ORDER BY horas DESC LIMIT 10) x)
  ) INTO v_out;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_bi_planta_abate(uuid, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_planta_abate(uuid, text, text, date, date) TO authenticated;

-- ── Menu, tela e "?" (RD-95) ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, subgrupo, rbac_isento, rbac_isento_motivo, so_ps)
VALUES ('industrial_bi_planta', 'BI da Planta', 'industrial', 'BarChart3', '/dashboard/industrial/bi-planta', 5, true,
        'Do produtor ao abate: compra de gado, preço da arroba, cabeças por dia, carcaça, origem do gado e horas do abate.',
        true, 'inteligencia_bi', true, 'Dados travados pela fn_bi_planta_abate (direção da empresa).', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('industrial_bi_planta', '/dashboard/industrial/bi-planta', 'industria', 'industrial_bi_planta', 'BI da Planta · Entrada e abate',
  'BI da planta (onda 1): compra de gado por produtor, cidade e categoria, preço da arroba, abate animal a animal, carcaça média e horas do abate. Genérico por ERP de origem.',
  'parcial', 'alta', ARRAY['fn_bi_planta_abate']::text[], ARRAY['BiPlanta']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'BI da Planta', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/industrial/bi-planta', 'industria', 'publicado'
FROM (VALUES
 ('planta.periodo', 'Período', 'Escolha o intervalo de datas.', 'Todos os números usam esse período; a comparação é com o período anterior de mesmo tamanho.', '"Este mês" compara com os mesmos dias do mês passado.', 'Comparar mês fechado com mês pela metade.', 1),
 ('planta.visao', 'Visão', 'Escolha toda a planta, só fêmeas ou só machos, e uma cidade de origem.', 'Recorta a compra e o abate. A cidade recorta só a compra (o abate não guarda a origem do animal).', 'Fêmeas › Dionísio Cerqueira.', 'Esperar que a cidade mude o número de cabeças abatidas.', 2),
 ('planta.cabecas', 'Cabeças abatidas', 'Indicador calculado.', 'Animais do romaneio de abate no período, um a um, inclusive abate de terceiros.', '1.392 cabeças em 19 dias = 73 por dia.', 'Somar com a compra: o boi comprado hoje pode ser abatido amanhã.', 3),
 ('planta.carcaca', 'Carcaça média', 'Indicador calculado.', 'Peso médio da carcaça por animal abatido. Uma arroba = 15 kg de carcaça.', '233,9 kg = 15,6 arrobas.', 'Confundir com peso vivo: o vivo é bem maior.', 4),
 ('planta.arroba', 'Preço da arroba', 'Indicador calculado.', 'Valor pago aos produtores dividido pelos kg de carcaça pagos, vezes 15. Só gado para abate (reposição fica fora).', 'R$ 352 por arroba em outubro.', 'Comparar com a arroba de São Paulo sem considerar frete e prêmios.', 5),
 ('planta.custo_cab', 'Custo por cabeça', 'Indicador calculado.', 'Valor pago aos produtores dividido pelas cabeças compradas.', 'R$ 5.465 por cabeça.', 'Esquecer que fêmea pesa menos e custa menos por cabeça.', 6),
 ('planta.femeas', 'Fêmeas no abate', 'Indicador calculado.', 'Parte das cabeças abatidas que são fêmeas. Afeta peso médio e rendimento.', '62,7% fêmeas.', 'Ler como problema: depende da oferta de gado da região.', 7),
 ('planta.horas', 'Horas do abate por cabeça', 'Indicador calculado.', 'Horas do ponto dos setores de abate divididas pelas cabeças abatidas pela própria planta.', '2,9 horas por cabeça.', 'Dia de pouco abate puxa o número para cima: a equipe é fixa.', 8),
 ('planta.produtores', 'Produtores', 'Indicador calculado.', 'Produtores com contra-nota no período, com cabeças, carcaça média e preço da arroba de cada um.', '256 produtores em outubro.', 'Comparar arroba de produtor com Nota 10 e sem: o Nota 10 recebe prêmio.', 9),
 ('planta.leituras', 'Leituras para a decisão', 'Nada a preencher.', 'Frases calculadas dos números da visão: variação da arroba, prêmio de qualidade, oscilação do abate e origem do gado.', '"Arroba subiu 8,2% contra setembro".', 'Ler como regra fixa: as frases mudam com a visão e o período.', 10)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
