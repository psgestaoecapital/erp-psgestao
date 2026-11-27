-- Indústria · Produtividade pela MESMA base do rendimento: o MIX de entrada (decisão do CEO 25/11). Por raia e por
-- posto da raia: horas padrão (entrada da raia × tempo padrão do posto) × horas reais (ponto das pessoas escaladas) =
-- produtividade %. Quando falta o dado, diz o motivo (sem tempo padrão, sem escala, sem entrada) em vez de inventar
-- zero. RD-26 (reusa prod_fluxo_etapa/prod_tarefa/prod_tarefa_tempo/prod_posto_pessoa/ind_ponto_dia/prod_estrutura/
-- ind_atak_fato). RD-100: "sistema vinculado".

-- Índice do hot path (idempotente — a PR do rendimento também o cria).
CREATE INDEX IF NOT EXISTS idx_ind_atak_fato_prod_data
  ON public.ind_atak_fato (company_id, dominio, (raw->>'DATA_ESTOQUE'), (raw->>'COD_PRODUTO'));

-- Códigos do sistema vinculado de cada produto (idempotente — mesma definição da PR do rendimento).
CREATE OR REPLACE FUNCTION public.fn_prod_codigos_externos(p_company_id uuid, p_plant_id uuid)
 RETURNS TABLE(produto_id uuid, codigo text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  RETURN QUERY
    SELECT pp.id, btrim(pp.chave_externa) FROM public.prod_produto pp
     WHERE pp.company_id = p_company_id AND pp.plant_id = p_plant_id
       AND pp.chave_externa IS NOT NULL AND btrim(pp.chave_externa) <> '';
  IF to_regclass('public.prod_produto_codigo_externo') IS NOT NULL THEN
    RETURN QUERY EXECUTE $q$
      SELECT ce.produto_id, btrim(ce.codigo) FROM public.prod_produto_codigo_externo ce
        JOIN public.prod_produto pp ON pp.id = ce.produto_id
       WHERE pp.company_id = $1 AND pp.plant_id = $2 AND ce.codigo IS NOT NULL AND btrim(ce.codigo) <> ''
    $q$ USING p_company_id, p_plant_id;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_codigos_externos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_codigos_externos(uuid, uuid) TO authenticated, service_role;

-- ───────────────────────────── fn_prod_produtividade_mix ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prod_produtividade_mix(
  p_company_id uuid, p_plant_id uuid, p_data_ini date, p_data_fim date, p_fluxo_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ini text; v_fim_excl text; v_out jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_data_ini IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;
  IF p_data_fim - p_data_ini > 120 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_maximo', 'limite_dias', 120);
  END IF;
  v_ini := to_char(p_data_ini, 'YYYY-MM-DD'); v_fim_excl := to_char((p_data_fim + 1), 'YYYY-MM-DD');

  WITH codes AS (SELECT produto_id, codigo FROM public.fn_prod_codigos_externos(p_company_id, p_plant_id)),
  atak_ent AS (
    SELECT (raw->>'COD_PRODUTO') cod, (left(raw->>'DATA_ESTOQUE', 10))::date dia, sum((raw->>'QTDE_KG')::numeric) kg
      FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0301' AND raw->>'COD_TIPO_MV' = 'F630'
       AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl GROUP BY 1, 2),
  atak_sai AS (
    SELECT (raw->>'COD_PRODUTO') cod, (left(raw->>'DATA_ESTOQUE', 10))::date dia, sum((raw->>'QTDE_KG')::numeric) kg
      FROM public.ind_atak_fato
     WHERE company_id = p_company_id AND dominio = 'producao_frigorifico'
       AND raw->>'PERFIL_TMV' = 'PCP0302' AND raw->>'COD_TIPO_MV' = 'F621'
       AND (raw->>'DATA_ESTOQUE') >= v_ini AND (raw->>'DATA_ESTOQUE') < v_fim_excl GROUP BY 1, 2),
  ent_prod_dia AS (SELECT c.produto_id, e.dia, sum(e.kg) kg FROM atak_ent e JOIN codes c ON c.codigo = e.cod GROUP BY 1, 2),
  sai_prod_dia AS (SELECT c.produto_id, s.dia, sum(s.kg) kg FROM atak_sai s JOIN codes c ON c.codigo = s.cod GROUP BY 1, 2),
  apo_prod_dia AS (
    SELECT a.produto_id, a.data dia, sum(a.qtd_produzida) kg FROM public.prod_apontamento_hora a
     WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.excluido_em IS NULL
       AND a.data >= p_data_ini AND a.data <= p_data_fim AND (p_fluxo_id IS NULL OR a.fluxo_id = p_fluxo_id) GROUP BY 1, 2),
  ent_tot AS (SELECT produto_id, sum(kg) kg FROM ent_prod_dia GROUP BY 1),
  sai_tot AS (SELECT produto_id, sum(kg) kg FROM sai_prod_dia GROUP BY 1),
  apo_tot AS (SELECT produto_id, sum(kg) kg FROM apo_prod_dia GROUP BY 1),
  -- entrada/saída por produto com fallback de apontamento, e por dia (para a série)
  ent_src_dia AS (
    SELECT produto_id, dia, kg FROM ent_prod_dia
    UNION ALL SELECT a.produto_id, a.dia, a.kg FROM apo_prod_dia a WHERE a.produto_id NOT IN (SELECT produto_id FROM ent_tot)),
  fluxos AS (
    SELECT f.id AS fluxo_id, f.nome AS fluxo_nome FROM public.prod_fluxo f
     WHERE f.company_id = p_company_id AND f.plant_id = p_plant_id AND f.ativo AND f.deleted_at IS NULL
       AND (p_fluxo_id IS NULL OR f.id = p_fluxo_id)),
  estr AS (
    SELECT DISTINCT e.fluxo_id, e.origem_produto_id, e.produto_id FROM public.prod_estrutura e
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo AND e.fluxo_id IS NOT NULL
       AND e.fluxo_id IN (SELECT fluxo_id FROM fluxos)),
  origens_fluxo AS (SELECT DISTINCT fluxo_id, origem_produto_id FROM estr),
  cortes_fluxo AS (SELECT DISTINCT fluxo_id, produto_id FROM estr),
  ent_fluxo AS (
    SELECT o.fluxo_id, sum(COALESCE(et.kg, ap.kg)) kg, bool_or(et.kg IS NOT NULL) tem_vinc
      FROM origens_fluxo o LEFT JOIN ent_tot et ON et.produto_id = o.origem_produto_id LEFT JOIN apo_tot ap ON ap.produto_id = o.origem_produto_id
     GROUP BY o.fluxo_id),
  sai_fluxo AS (
    SELECT c.fluxo_id, sum(COALESCE(st.kg, ap.kg)) kg
      FROM cortes_fluxo c LEFT JOIN sai_tot st ON st.produto_id = c.produto_id LEFT JOIN apo_tot ap ON ap.produto_id = c.produto_id
     GROUP BY c.fluxo_id),
  ent_fluxo_dia AS (
    SELECT o.fluxo_id, d.dia, sum(d.kg) kg FROM origens_fluxo o JOIN ent_src_dia d ON d.produto_id = o.origem_produto_id GROUP BY o.fluxo_id, d.dia),
  postos_fluxo AS (
    SELECT DISTINCT fe.fluxo_id, fe.posto_id FROM public.prod_fluxo_etapa fe
     WHERE fe.company_id = p_company_id AND fe.plant_id = p_plant_id AND fe.deleted_at IS NULL AND fe.posto_id IS NOT NULL
       AND fe.fluxo_id IN (SELECT fluxo_id FROM fluxos)),
  seg_posto AS (  -- tempo padrão do posto = média das medições (seg_por_kg) das tarefas das etapas do posto na raia
    SELECT fe.fluxo_id, fe.posto_id, avg(tt.seg_por_kg) seg
      FROM public.prod_fluxo_etapa fe
      JOIN public.prod_tarefa t ON t.etapa_id = fe.id
      JOIN public.prod_tarefa_tempo tt ON tt.tarefa_id = t.id AND tt.seg_por_kg IS NOT NULL
     WHERE fe.company_id = p_company_id AND fe.plant_id = p_plant_id AND fe.deleted_at IS NULL
     GROUP BY fe.fluxo_id, fe.posto_id),
  escala AS (  -- pessoas escaladas no posto, vigência cobrindo o período
    SELECT DISTINCT pp.posto_id, pp.cpf FROM public.prod_posto_pessoa pp
     WHERE pp.company_id = p_company_id AND pp.plant_id = p_plant_id AND pp.cpf IS NOT NULL
       AND pp.vigencia_inicio <= p_data_fim AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= p_data_ini)),
  horas_posto AS (
    SELECT e.posto_id, sum(pd.worked_seconds) secs FROM escala e
      JOIN public.ind_ponto_dia pd ON pd.company_id = p_company_id AND pd.plant_id = p_plant_id AND pd.cpf = e.cpf
       AND pd.data >= p_data_ini AND pd.data <= p_data_fim
     GROUP BY e.posto_id),
  horas_posto_dia AS (
    SELECT e.posto_id, pd.data dia, sum(pd.worked_seconds) secs FROM escala e
      JOIN public.ind_ponto_dia pd ON pd.company_id = p_company_id AND pd.plant_id = p_plant_id AND pd.cpf = e.cpf
       AND pd.data >= p_data_ini AND pd.data <= p_data_fim
     GROUP BY e.posto_id, pd.data),
  posto_calc AS (
    SELECT pf.fluxo_id, pf.posto_id,
           (coalesce(nullif(btrim(pp.numero), ''), 'Posto') || coalesce(' · ' || nullif(btrim(pp.atividade), ''), '')) AS posto_nome,
           ef.kg AS entrada_kg, sf.kg AS saida_kg, sp.seg AS seg_por_kg, hp.secs AS secs,
           CASE WHEN sp.seg IS NOT NULL AND ef.kg IS NOT NULL THEN ef.kg * sp.seg / 3600.0 END AS horas_padrao,
           CASE WHEN hp.secs IS NOT NULL THEN hp.secs / 3600.0 END AS horas_reais
      FROM postos_fluxo pf
      JOIN public.prod_posto pp ON pp.id = pf.posto_id
      LEFT JOIN ent_fluxo ef ON ef.fluxo_id = pf.fluxo_id
      LEFT JOIN sai_fluxo sf ON sf.fluxo_id = pf.fluxo_id
      LEFT JOIN seg_posto sp ON sp.fluxo_id = pf.fluxo_id AND sp.posto_id = pf.posto_id
      LEFT JOIN horas_posto hp ON hp.posto_id = pf.posto_id),
  serie_posto AS (
    SELECT pf.fluxo_id, pf.posto_id,
      jsonb_agg(jsonb_build_object(
        'dia', dd.dia,
        'horas_padrao', round(efd.kg * sp.seg / 3600.0, 3),
        'horas_reais', round(hpd.secs / 3600.0, 3),
        'produtividade_pct', CASE WHEN hpd.secs > 0 AND efd.kg IS NOT NULL AND sp.seg IS NOT NULL THEN round((efd.kg * sp.seg) / hpd.secs * 100, 2) END
      ) ORDER BY dd.dia) AS serie
      FROM postos_fluxo pf
      JOIN (SELECT DISTINCT fluxo_id, dia FROM ent_fluxo_dia) dd ON dd.fluxo_id = pf.fluxo_id
      LEFT JOIN seg_posto sp ON sp.fluxo_id = pf.fluxo_id AND sp.posto_id = pf.posto_id
      LEFT JOIN ent_fluxo_dia efd ON efd.fluxo_id = pf.fluxo_id AND efd.dia = dd.dia
      LEFT JOIN horas_posto_dia hpd ON hpd.posto_id = pf.posto_id AND hpd.dia = dd.dia
     GROUP BY pf.fluxo_id, pf.posto_id),
  postos_js AS (
    SELECT pc.fluxo_id, jsonb_agg(jsonb_build_object(
      'posto_id', pc.posto_id, 'posto_nome', pc.posto_nome,
      'seg_por_kg', round(pc.seg_por_kg, 4),
      'horas_padrao', round(pc.horas_padrao, 2),
      'horas_reais', round(pc.horas_reais, 2),
      'produtividade_pct', CASE WHEN pc.horas_reais IS NOT NULL AND pc.horas_reais <> 0 AND pc.horas_padrao IS NOT NULL THEN round(pc.horas_padrao / pc.horas_reais * 100, 2) END,
      'kg_por_homem_hora', CASE WHEN pc.horas_reais IS NOT NULL AND pc.horas_reais <> 0 AND pc.saida_kg IS NOT NULL THEN round(pc.saida_kg / pc.horas_reais, 2) END,
      'status', CASE WHEN pc.entrada_kg IS NULL OR pc.entrada_kg = 0 THEN 'sem_entrada'
                     WHEN pc.seg_por_kg IS NULL THEN 'sem_tempo_padrao'
                     WHEN pc.horas_reais IS NULL OR pc.horas_reais = 0 THEN 'sem_escala'
                     ELSE 'ok' END,
      'serie', COALESCE(sp.serie, '[]'::jsonb)
    ) ORDER BY pc.posto_nome) AS postos
      FROM posto_calc pc LEFT JOIN serie_posto sp ON sp.fluxo_id = pc.fluxo_id AND sp.posto_id = pc.posto_id
     GROUP BY pc.fluxo_id),
  raias_js AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'fluxo_id', f.fluxo_id, 'fluxo_nome', f.fluxo_nome,
      'entrada_kg', round(ef.kg, 2), 'saida_kg', round(sf.kg, 2),
      'fonte', CASE WHEN ef.tem_vinc THEN 'sistema_vinculado' WHEN ef.kg IS NOT NULL THEN 'apontamento' END,
      'postos', COALESCE(pj.postos, '[]'::jsonb)
    ) ORDER BY f.fluxo_nome), '[]'::jsonb) js
      FROM fluxos f
      LEFT JOIN ent_fluxo ef ON ef.fluxo_id = f.fluxo_id
      LEFT JOIN sai_fluxo sf ON sf.fluxo_id = f.fluxo_id
      LEFT JOIN postos_js pj ON pj.fluxo_id = f.fluxo_id)
  SELECT js INTO v_out FROM raias_js;

  RETURN jsonb_build_object('ok', true, 'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim), 'raias', v_out);
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_produtividade_mix(uuid, uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produtividade_mix(uuid, uuid, date, date, uuid) TO authenticated, service_role;

-- ───────────────────────────── Ajuda de campo (RD-95) — tela Produtividade (por posto) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('prod.produtividade.aba', '/dashboard/produtividade/indicadores', 'Produtividade', 'Produtividade por posto (mix)',
  'Mostra, por raia e por posto, as horas padrão × as horas reais do ponto.',
  'Separa o indicador por posto para achar onde a mão de obra rende mais ou menos.',
  'Desossa · posto Serra', 'Comparar postos de raias diferentes sem olhar a entrada de cada uma.', 'industria', 1, 1, 'publicado'),
 ('prod.produtividade.planta', '/dashboard/produtividade/indicadores', 'Produtividade', 'Planta',
  'Escolha a planta industrial para ver os postos dela.',
  'Cada planta tem seus próprios fluxos e postos; o indicador é por planta.',
  'Frigorífico Magia', 'Comparar postos de plantas diferentes.', 'industria', 1, 1, 'publicado'),
 ('prod.produtividade.periodo', '/dashboard/produtividade/indicadores', 'Produtividade', 'Período',
  'O intervalo de datas (até 120 dias) usado para somar a entrada, a saída e as horas do ponto.',
  'Define a janela do indicador; períodos muito curtos têm pouco dado.',
  '01/11 a 30/11', 'Pedir mais de 120 dias — o sistema recusa.', 'industria', 1, 1, 'publicado'),
 ('prod.produtividade.raia', '/dashboard/produtividade/indicadores', 'Produtividade', 'Raia (fluxo)',
  'Escolha a raia para ver só os postos dela, ou deixe em "Todas".',
  'A produtividade é medida pela entrada da raia; separar por raia evita misturar processos.',
  'Desossa', 'Somar postos de raias diferentes.', 'industria', 2, 1, 'publicado'),
 ('prod.produtividade.horas_padrao', '/dashboard/produtividade/indicadores', 'Produtividade', 'Horas padrão',
  'Quanto tempo a produção do período DEVERIA levar: entrada da raia × tempo padrão do posto (seg/kg) ÷ 3600.',
  'É a meta de horas dada pelo que entrou e pelo tempo padrão medido do posto.',
  '230 kg × 36 s/kg ÷ 3600 = 2,3 h', 'Usar horas padrão quando o posto ainda não tem tempo padrão medido.', 'industria', 3, 1, 'publicado'),
 ('prod.produtividade.horas_reais', '/dashboard/produtividade/indicadores', 'Produtividade', 'Horas reais',
  'As horas trabalhadas no ponto pelas pessoas escaladas no posto, no período.',
  'É o esforço real gasto; comparado com as horas padrão, dá a produtividade.',
  '2,0 h no ponto', 'Esquecer de escalar as pessoas no posto — sem escala não há horas reais.', 'industria', 4, 1, 'publicado'),
 ('prod.produtividade.pct', '/dashboard/produtividade/indicadores', 'Produtividade', 'Produtividade (%)',
  'Horas padrão ÷ horas reais × 100. Acima de 100% rendeu mais que o padrão; abaixo, menos.',
  'Resume se o posto está rendendo conforme o tempo padrão, dado o que entrou.',
  'Padrão 2,3 h / real 2,0 h = 115%', 'Ler a produtividade quando falta tempo padrão, escala ou entrada.', 'industria', 5, 1, 'publicado'),
 ('prod.produtividade.kg_hh', '/dashboard/produtividade/indicadores', 'Produtividade', 'kg por homem-hora',
  'Quantos kg o posto entregou por hora trabalhada (saída da raia ÷ horas reais).',
  'Mostra o volume por hora de trabalho, para comparar postos e períodos.',
  '1.200 kg ÷ 2 h = 600 kg/h', 'Comparar kg/h entre postos de raias com produtos muito diferentes.', 'industria', 6, 1, 'publicado'),
 ('prod.produtividade.motivo', '/dashboard/produtividade/indicadores', 'Produtividade', 'Motivo (sem dado)',
  'Quando falta algo para o cálculo, aparece o motivo: sem tempo padrão, sem escala ou sem entrada.',
  'Mostra exatamente o que falta cadastrar para o posto passar a medir.',
  'sem tempo padrão', 'Tratar "sem dado" como produtividade zero.', 'industria', 7, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, status = EXCLUDED.status, atualizado_em = now();
