-- Custeio por kg · fatia F5 — PADRÃO DE RENDIMENTO (padrão × real) — CEO 11/12, contexto 46b4527a, RD-102.
-- Tela nova /dashboard/produtividade/rendimento ("Rendimentos"): por produto de ORIGEM, as saídas (cortes,
-- osso, sebo, aparas) com o rendimento PADRÃO % (prod_estrutura.rendimento_padrao_pct, editável na própria raia
-- do Mapa) comparado com o rendimento REAL % do período. O real vem da PRODUÇÃO APONTADA (prod_apontamento_hora),
-- alimentada por apontamento próprio, importação por planilha ou conector genérico de produção (RD-102). A tela
-- mostra a diferença em kg e em R$ (preço de referência do produto) e avisa quando as saídas de uma origem não
-- somam ~100%. Genérico para qualquer indústria/planta (bovinos, suínos, aves, serraria).
--
-- ADITIVA (RD-97): só CRIA uma função de leitura nova, textos de ajuda (RD-95), o registro da tela (RD-98 p3) e
-- um DEMO fictício na empresa DEMO Indústria (RD-69). NÃO cria/altera tabela, RLS, grant de tabela, nem função
-- existente; não toca dado de cliente. A função é STABLE SECURITY DEFINER com a mesma guarda das demais
-- (fn_prod_assert_planta) e os mesmos grants do padrão industrial (authenticated/service_role; anon sem EXECUTE).
-- Faixa de segundos do dev7claudeps (:15), versão acima do ledger.

-- ============================================================ 1) FUNÇÃO · padrão × real por origem/saída
CREATE OR REPLACE FUNCTION public.fn_prod_rendimento_comparativo(
  p_company_id uuid,
  p_plant_id   uuid,
  p_data_ini   date,
  p_data_fim   date
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
DECLARE v_origens jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_data_ini IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;

  WITH real_kg AS (  -- kg real por produto no período (produção apontada: apontamento/planilha/conector)
    SELECT a.produto_id, sum(a.qtd_produzida)::numeric AS kg
      FROM public.prod_apontamento_hora a
     WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id
       AND a.data >= p_data_ini AND a.data <= p_data_fim
     GROUP BY a.produto_id
  ),
  est AS (  -- padrão: cada origem e suas saídas (estrutura ativa)
    SELECT e.origem_produto_id, e.produto_id, e.tipo_saida, e.rendimento_padrao_pct,
           po.codigo AS origem_codigo, po.nome AS origem_nome,
           ps.codigo AS saida_codigo, ps.nome AS saida_nome, ps.preco_venda_ref AS preco
      FROM public.prod_estrutura e
      JOIN public.prod_produto po ON po.id = e.origem_produto_id
      JOIN public.prod_produto ps ON ps.id = e.produto_id
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo
  ),
  linhas AS (
    SELECT est.*,
           COALESCE(ro.kg, 0)::numeric AS origem_kg,
           COALESCE(rs.kg, 0)::numeric AS saida_kg,
           (ro.kg IS NOT NULL AND ro.kg > 0) AS tem_origem
      FROM est
      LEFT JOIN real_kg ro ON ro.produto_id = est.origem_produto_id
      LEFT JOIN real_kg rs ON rs.produto_id = est.produto_id
  ),
  por_saida AS (
    SELECT l.origem_produto_id, l.origem_codigo, l.origem_nome, l.origem_kg, l.tem_origem,
      l.rendimento_padrao_pct AS padrao_pct,
      CASE WHEN l.tem_origem THEN l.saida_kg / l.origem_kg * 100.0 END AS real_pct_v,
      jsonb_build_object(
        'produto_id',  l.produto_id,
        'codigo',      l.saida_codigo,
        'nome',        l.saida_nome,
        'tipo_saida',  l.tipo_saida,
        'padrao_pct',  l.rendimento_padrao_pct,
        'esperado_kg', CASE WHEN l.tem_origem THEN round(l.origem_kg * COALESCE(l.rendimento_padrao_pct,0)/100.0, 2) END,
        'real_kg',     CASE WHEN l.tem_origem THEN round(l.saida_kg, 2) END,
        'real_pct',    CASE WHEN l.tem_origem THEN round(l.saida_kg / l.origem_kg * 100.0, 2) END,
        'diff_pct',    CASE WHEN l.tem_origem AND l.rendimento_padrao_pct IS NOT NULL
                            THEN round(l.saida_kg / l.origem_kg * 100.0 - l.rendimento_padrao_pct, 2) END,
        'diff_kg',     CASE WHEN l.tem_origem
                            THEN round(l.saida_kg - l.origem_kg * COALESCE(l.rendimento_padrao_pct,0)/100.0, 2) END,
        'preco_ref',   l.preco,
        'diff_rs',     CASE WHEN l.tem_origem AND l.preco IS NOT NULL
                            THEN round((l.saida_kg - l.origem_kg * COALESCE(l.rendimento_padrao_pct,0)/100.0) * l.preco, 2) END
      ) AS saida
    FROM linhas l
  ),
  agrup AS (
    SELECT origem_produto_id,
           max(origem_codigo) AS origem_codigo,
           max(origem_nome)   AS origem_nome,
           max(origem_kg)     AS origem_kg,
           bool_or(tem_origem) AS tem_origem,
           sum(padrao_pct)    AS soma_padrao,
           CASE WHEN bool_or(tem_origem) THEN sum(real_pct_v) END AS soma_real,
           jsonb_agg(saida ORDER BY (saida->>'tipo_saida'), (saida->>'codigo')) AS saidas
      FROM por_saida
     GROUP BY origem_produto_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'origem_produto_id', origem_produto_id,
           'origem_codigo',     origem_codigo,
           'origem_nome',       origem_nome,
           'origem_kg',         CASE WHEN tem_origem THEN round(origem_kg, 2) END,
           'tem_real',          tem_origem,
           'soma_padrao_pct',   round(soma_padrao, 2),
           'soma_real_pct',     round(soma_real, 2),
           'soma_fora_100',     (soma_padrao IS NOT NULL AND (soma_padrao < 97 OR soma_padrao > 103)),
           'saidas',            saidas
         ) ORDER BY origem_codigo), '[]'::jsonb) INTO v_origens
    FROM agrup;

  RETURN jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim),
    'origens', v_origens
  );
END $fn$;

REVOKE ALL ON FUNCTION public.fn_prod_rendimento_comparativo(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_rendimento_comparativo(uuid, uuid, date, date) TO authenticated, service_role;

-- ============================================================ 2) RD-95 · textos de ajuda ("?") da tela
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade/rendimento', 'industria', 'publicado'
FROM (VALUES
 ('prod.rendimento.planta', 'Filtros', 'Planta',
  'Escolha a planta (unidade) cuja produção você quer comparar. Cada planta tem seus próprios produtos e rendimentos.',
  'O rendimento padrão e o real são por planta — trocar a planta troca os dados da tela.',
  'Planta Demo.',
  'Comparar plantas diferentes na mesma linha: selecione uma planta por vez.', 10),
 ('prod.rendimento.periodo', 'Filtros', 'Período',
  'Informe o intervalo de datas da produção a comparar (início e fim). O real é a soma do que foi apontado nessas datas.',
  'Define sobre qual produção o rendimento REAL é calculado; o padrão não muda com o período.',
  'Do dia 1º ao dia 30 do mês.',
  'Período sem produção apontada: o real fica vazio e só o padrão aparece.', 20),
 ('prod.rendimento.origem', 'Comparativo', 'Produto de origem',
  'É o produto que ENTRA e é desmontado (ex.: o boi no abate, a carcaça na desossa). As saídas abaixo são frações dele.',
  'Agrupa as saídas pelo que lhes deu origem; o rendimento de cada saída é medido sobre o kg desta origem.',
  'Carcaça bovina → dianteiro, coxão, picanha, sebo.',
  'Procurar a origem noutra tela: a origem/saída é cadastrada na raia do Mapa (Entra/Sai).', 30),
 ('prod.rendimento.origem_kg', 'Comparativo', 'Kg da origem (real)',
  'Quantidade real (kg) desta origem produzida/processada no período, somada da produção apontada.',
  'É a base do rendimento real: o kg de cada saída é dividido por este valor para dar o % real.',
  '20.000 kg de boi em pé no período.',
  'Esperar kg aqui sem apontamento: sem produção lançada no período a origem fica sem kg e não há real.', 40),
 ('prod.rendimento.tipo_saida', 'Comparativo', 'Tipo de saída',
  'Classificação da saída: Principal (produto de maior valor), Coproduto (também vendido) ou Subproduto (resíduo, osso, sebo, aparas).',
  'Ajuda a ler o rendimento e, mais adiante, a ratear o custo entre as saídas.',
  'Dianteiro = Principal; sebo = Subproduto.',
  'Marcar tudo como Principal: o tipo separa produto de venda de resíduo.', 50),
 ('prod.rendimento.padrao_pct', 'Comparativo', 'Rendimento padrão (%)',
  'O rendimento teórico/histórico esperado da saída sobre a origem. É editado na raia do Mapa (Entra/Sai); aqui só é exibido.',
  'É a meta/referência contra a qual o rendimento real do período é comparado.',
  'Coxão mole com padrão de 9% da carcaça.',
  'Trocar o padrão aqui: o padrão se altera no Mapa do fluxo; esta tela compara, não edita o padrão.', 60),
 ('prod.rendimento.real_pct', 'Comparativo', 'Rendimento real (%)',
  'O rendimento efetivamente obtido no período: kg real da saída ÷ kg real da origem × 100.',
  'Mostra o que a planta realmente rendeu, para comparar com o padrão e achar perdas ou ganhos.',
  'Se de 10.700 kg de carcaça saíram 1.016 kg de coxão, o real é 9,5%.',
  'Comparar com padrão sem produção no período: sem apontamento não há real para comparar.', 70),
 ('prod.rendimento.diff_pct', 'Comparativo', 'Diferença (p.p.)',
  'Diferença entre o real e o padrão, em pontos percentuais (real − padrão). Positivo rende mais que o padrão; negativo, menos.',
  'Aponta rapidamente onde a planta está acima ou abaixo do esperado.',
  'Real 9,5% − padrão 9,0% = +0,5 p.p.',
  'Confundir p.p. com %: aqui é a diferença dos percentuais, não variação relativa.', 80),
 ('prod.rendimento.diff_kg', 'Comparativo', 'Diferença (kg)',
  'Quantos kg a mais (ou a menos) saíram em relação ao esperado pelo padrão, no período.',
  'Transforma a diferença de rendimento em quilos ganhos ou perdidos — a conversa do chão de fábrica.',
  '+53 kg de sebo acima do padrão; −107 kg de dianteiro abaixo.',
  'Ler kg sem período: a diferença em kg depende do volume real do período.', 90),
 ('prod.rendimento.diff_rs', 'Comparativo', 'Diferença (R$)',
  'A diferença em kg avaliada pelo preço de referência do produto (preço de venda). Só aparece quando o produto tem preço.',
  'Dá a dimensão financeira do desvio de rendimento — quanto se ganhou ou deixou de ganhar.',
  '−107 kg de dianteiro × R$ 26,00 = −R$ 2.782,00.',
  'Produto sem preço: sem preço de referência o R$ fica em branco; cadastre o preço do produto.', 100),
 ('prod.rendimento.soma', 'Comparativo', 'Soma das saídas (%)',
  'A soma dos rendimentos padrão das saídas de uma mesma origem. O ideal é ficar perto de 100% (tudo que entra sai como algo).',
  'Avisa quando faltam saídas cadastradas (soma muito abaixo de 100%) ou quando há excesso (acima de 100%).',
  'Dianteiro 48% + coxão 9% + picanha 2% + sebo 12% = 71% → faltam saídas.',
  'Ignorar o aviso: uma origem que não soma ~100% tem saídas faltando no cadastro (Mapa).', 110)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- ============================================================ 3) RD-98 p3 · origem do dado (system_screens)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, modulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/produtividade/rendimento', 'industria', 'Rendimentos (padrão × real)',
       'Compara, por produto de origem, o rendimento PADRÃO de cada saída (prod_estrutura, editado no Mapa) com o rendimento REAL do período (produção apontada em prod_apontamento_hora), mostrando a diferença em kg e em R$ (preço de referência) e avisando quando as saídas de uma origem não somam ~100%. Genérico para qualquer indústria (RD-102).',
       ARRAY['prod_estrutura','prod_apontamento_hora','prod_produto','industrial_plants'],
       ARRAY['fn_prod_rendimento_comparativo'],
       'produtividade', 'pronto'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='system_screens')
  AND NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/produtividade/rendimento');

-- ============================================================ 4) DEMO Indústria (RD-69) · produção fictícia p/ a comparação aparecer
-- Só na empresa DEMO (is_demo=true): preços de referência fictícios e produção apontada fictícia de um dia, para a
-- tela de Rendimentos mostrar padrão × real com diferença em kg e R$. NUNCA roda em dado de cliente. Idempotente.
DO $demo$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000005';
  v_plant   uuid := '49a0d5ae-c5f8-4969-a40e-46f800f1a2a1';
  v_setor   uuid;
  v_fluxo   uuid;
  v_dia     date := CURRENT_DATE;
  v_boi uuid; v_carc uuid; v_dia_p uuid; v_coxao uuid; v_pic uuid; v_sebo uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company AND is_demo IS TRUE) THEN
    RAISE NOTICE 'Empresa DEMO Indústria (005) ausente ou não-DEMO — seed de rendimento ignorado (RD-69)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM industrial_plants WHERE id = v_plant AND company_id = v_company) THEN
    RAISE NOTICE 'Planta DEMO ausente — seed de rendimento ignorado';
    RETURN;
  END IF;

  SELECT id INTO v_boi   FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-001';
  SELECT id INTO v_carc  FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-010';
  SELECT id INTO v_dia_p FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-100';
  SELECT id INTO v_coxao FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-202';
  SELECT id INTO v_pic   FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-204';
  SELECT id INTO v_sebo  FROM prod_produto WHERE company_id = v_company AND plant_id = v_plant AND codigo = 'BOV-400';
  IF v_boi IS NULL OR v_carc IS NULL THEN
    RAISE NOTICE 'Produtos DEMO de abate/desossa ausentes — seed de rendimento ignorado';
    RETURN;
  END IF;

  -- 4a) preços de referência fictícios (só onde ainda não houver; não sobrescreve)
  UPDATE prod_produto SET preco_venda_ref = x.preco, updated_at = now()
    FROM (VALUES (v_boi, 18.00::numeric), (v_carc, 22.00), (v_dia_p, 26.00),
                 (v_coxao, 45.00), (v_pic, 90.00), (v_sebo, 4.00)) AS x(id, preco)
   WHERE prod_produto.id = x.id AND prod_produto.company_id = v_company AND prod_produto.preco_venda_ref IS NULL;

  -- 4b) uma raia-âncora (prod_apontamento_hora exige fluxo_id). Reusa a raia da desossa se já existir; senão cria.
  SELECT id INTO v_setor FROM prod_setor WHERE company_id = v_company AND nome ILIKE 'Desossa%' LIMIT 1;
  SELECT id INTO v_fluxo FROM prod_fluxo
    WHERE company_id = v_company AND plant_id = v_plant AND nome = 'Linha de Desossa'
      AND COALESCE(ativo, true) = true
    LIMIT 1;
  IF v_fluxo IS NULL AND v_setor IS NOT NULL THEN
    INSERT INTO prod_fluxo(company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
    VALUES (v_company, v_plant, v_setor, 'Linha de Desossa', 'compartilhado', 'desmontagem', 2, true)
    RETURNING id INTO v_fluxo;
  END IF;
  IF v_fluxo IS NULL THEN
    RAISE NOTICE 'Sem raia-âncora na DEMO — seed de produção fictícia ignorado';
    RETURN;
  END IF;

  -- 4c) produção apontada fictícia do dia (kg real ligeiramente fora do padrão p/ mostrar as diferenças).
  --     real: carcaça 53,5% do boi; dianteiro 47% / coxão 9,5% / picanha 1,8% / sebo 12,5% da carcaça.
  INSERT INTO prod_apontamento_hora (company_id, plant_id, fluxo_id, posto_id, produto_id, data, hora, qtd_produzida, unidade, fonte)
  SELECT v_company, v_plant, v_fluxo, NULL, x.pid, v_dia, x.hora, x.kg, 'kg', 'manual'
  FROM (VALUES
          (v_boi,   8, 20000.0::numeric),
          (v_carc,  9, 10700.0),
          (v_dia_p, 10, 5029.0),
          (v_coxao, 11, 1016.5),
          (v_pic,   12,  192.6),
          (v_sebo,  13, 1337.5)
       ) AS x(pid, hora, kg)
  ON CONFLICT (company_id, fluxo_id, posto_id, produto_id, data, hora) DO NOTHING;

  RAISE NOTICE 'DEMO rendimento semeado (RD-69): raia %, dia %', v_fluxo, v_dia;
END $demo$;
