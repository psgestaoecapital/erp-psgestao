-- Painel comercial: FATURAMENTO SEM VENDA BALCÃO + DEVOLUÇÃO POR PRODUTO (CEO 13/11, contexto 61723f79).
-- Deixa o faturamento líquido do painel próximo do ATAK (RMVS713), tirando a diferença enorme (~R$ 3,4 mi).
--
-- PROVA NO DADO (o CEO rodou no SQL Editor — Frioeste 975365cc, ano 2026; o execute_sql do MCP estava fora):
--   · COM balcão (hoje):                               líquido R$ 113,8 mi  — R$ 3,4 mi ACIMA do ATAK.
--   · SEM balcão (520,T520,T820,T830,T831) + dev/prod: líquido R$ 108.367.682 — bem mais próximo.
--   · ATAK RMVS713 (alvo): R$ 110.360.188 · devolução RMVE011: R$ 3.875.239.
--   · COXÃO MOLE (cod 47) sem balcão ≈ 237.914 kg / R$ 8.871.303 (ATAK 233.843 kg / R$ 8.714.583).
-- Alvo: "não precisa cravar, só ficar próximo" (CEO). Ajuste fino depois (Fabiane confirma se parte do balcão entra).
--
-- O QUE MUDA (só EXIBIÇÃO/cálculo — a venda bruta armazenada em ind_atak_fato / na MV NÃO é alterada):
--   1) Tipos de VENDA que entram no faturamento: 520, T520, T820, T830, T831. FICAM FORA: 5200/5201 (balcão) e 5235
--      (perda). Configurável por empresa (RD-102, erp_comercial_tipo_movimento) — SEM hardcode.
--   2) Faturamento LÍQUIDO = Σ por COD_PRODUTO de GREATEST(venda_bruta_produto − devolução_do_produto, 0) — casado
--      por produto, com floor em 0 (produto cuja devolução > venda no período não vira negativo), tipos de devolução
--      T582, T583, T584, T585.
--   3) Balcão (5200/5201) e Perda (5235) viram indicadores SEPARADOS "venda_balcao" / "perda" (informativos, fora do
--      faturamento principal).
--
-- SEGURANÇA DE ESCOPO: a lista de tipos de venda é semeada SÓ para a Frioeste (company_id). Empresa sem config de
-- 'venda' cai no comportamento ATUAL (sem filtro de tipo) — nenhum outro painel é afetado. fn_bi_comercial_kpis e
-- fn_bi_comercial_produtos seguem SECURITY DEFINER com a MESMA guarda (fn_bi_comercial_scope / get_user_company_ids).
--
-- OBS T584 (CEO: "falta R$ 182"): o conector (atak_fonte_mapa) hoje só PUXA a devolução T582/T583/T585; o T584 entra
-- na config de abate (no-op até o conector puxá-lo) — puxar o histórico de T584 é uma janela de re-pull à parte
-- (como a #4851), de valor desprezível para o fechamento. Não se toca o conector aqui.
--
-- Aditiva: amplia o CHECK da categoria, semeia tipos, e faz CREATE OR REPLACE (só acréscimo de lógica/campos) das
-- duas RPCs. Sem DROP de objeto, sem DELETE/UPDATE em massa, sem tocar dado de cliente.

-- =====================================================================================
-- 1) Categorias de tipo de movimento: além de devolucao_abate/descarte, agora venda/venda_balcao/venda_perda.
-- =====================================================================================
ALTER TABLE public.erp_comercial_tipo_movimento
  DROP CONSTRAINT IF EXISTS erp_comercial_tipo_movimento_categoria_check;
ALTER TABLE public.erp_comercial_tipo_movimento
  ADD CONSTRAINT erp_comercial_tipo_movimento_categoria_check
  CHECK (categoria IN ('venda','venda_balcao','venda_perda','devolucao_abate','descarte'));

-- Config da FRIOESTE (company-específica, não global: não muda o painel de nenhuma outra empresa). Idempotente.
-- Semeia também a devolução T582/T583/T584/T585 própria da Frioeste (quando a empresa tem config própria de
-- devolucao_abate, fn_comercial_tipos_efetivos usa só a dela — por isso listamos as 4 completas).
INSERT INTO public.erp_comercial_tipo_movimento (company_id, categoria, cod_tipo_mv, descricao)
SELECT * FROM (VALUES
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda',           '520',  'Venda — nota fiscal'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda',           'T520', 'Venda — série T520'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda',           'T820', 'Venda — série T820'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda',           'T830', 'Venda — série T830'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda',           'T831', 'Venda — série T831'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_balcao',    '5200', 'Venda balcão'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_balcao',    '5201', 'Venda balcão'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_perda',     '5235', 'Nota de perda'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'devolucao_abate', 'T582', 'Devolução de venda — NF própria (entrada)'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'devolucao_abate', 'T583', 'Devolução de venda — NF do cliente'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'devolucao_abate', 'T584', 'Devolução de venda — série T584'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'devolucao_abate', 'T585', 'Devolução de venda — série T585')
) AS v(company_id, categoria, cod_tipo_mv, descricao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_comercial_tipo_movimento e
  WHERE e.company_id IS NOT DISTINCT FROM v.company_id
    AND e.categoria = v.categoria AND e.cod_tipo_mv = v.cod_tipo_mv);

-- =====================================================================================
-- 2) fn_bi_comercial_kpis: faturamento SEM balcão + líquido por produto (floor) + indicadores balcão/perda.
--    TODOS os campos existentes são preservados; só há acréscimo. Guarda e escopo de vendedor inalterados.
--    O tipo de movimento vem de um join leve na ind_atak_fato pela chave única do item (f.chave_fato = m.fato_id),
--    mesmo padrão já usado em fn_bi_comercial_pareto — a MV não precisa ser reconstruída.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope jsonb; v_vend text; r RECORD;
  v_tipos_venda  text[]; v_tipos_balcao text[]; v_tipos_perda text[];
  v_tipos_dev    text[]; v_tipos_desc  text[];
  v_dev_valor  numeric := 0; v_dev_kg numeric := 0; v_dev_tipos jsonb := '[]'::jsonb;
  v_balcao_valor numeric := 0; v_balcao_kg numeric := 0;
  v_perda_valor  numeric := 0; v_perda_kg  numeric := 0;
  v_desc_valor numeric := 0; v_desc_kg numeric := 0; v_desc_linhas int := 0;
  v_desc_prod  jsonb := '[]'::jsonb; v_desc_vend jsonb := '[]'::jsonb; v_desc_linha jsonb := '[]'::jsonb;
  v_clientes int := 0; v_cidades int := 0;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;

  -- Tipos configurados (por empresa, com fallback global). venda vazio => sem filtro de tipo (comportamento atual).
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_venda  FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_balcao FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_balcao');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_perda  FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_perda');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev    FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_desc   FROM public.fn_comercial_tipos_efetivos(p_company_id, 'descarte');

  -- Itens de venda do período (com o tipo de movimento e a classificação), e a devolução que abate por produto.
  WITH itens AS (
    SELECT m.produto_cod, m.kg, m.valor, m.carne, m.cliente_cod, m.cidade,
           c.status AS clas_status,
           trim(f.raw->>'COD_TIPO_MV') AS cod_tipo_mv
      FROM public.bi_comercial_venda_item_mv m
      LEFT JOIN public.ind_atak_fato f
             ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
      LEFT JOIN public.bi_comercial_produto_classificacao c
             ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
     WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
       AND (v_vend IS NULL OR m.vendedor = v_vend)
  ),
  venda AS (  -- só os tipos de venda (ou tudo, se a empresa não configurou 'venda')
    SELECT * FROM itens
     WHERE v_tipos_venda IS NULL OR cod_tipo_mv = ANY (v_tipos_venda)
  ),
  venda_prod AS (
    SELECT produto_cod,
           sum(valor) AS venda_valor, sum(kg) AS venda_kg,
           sum(valor) FILTER (WHERE carne) AS venda_valor_carne,
           sum(kg)    FILTER (WHERE carne) AS venda_kg_carne,
           sum(valor) FILTER (WHERE clas_status = 'entra') AS venda_valor_sel,
           sum(kg)    FILTER (WHERE clas_status = 'entra') AS venda_kg_sel
      FROM venda GROUP BY produto_cod
  ),
  dev_prod AS (
    SELECT trim(f.raw->>'COD_PRODUTO') AS cod,
           sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric) AS dev_valor,
           sum(CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END) AS dev_kg
      FROM public.ind_atak_fato f
     WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
       AND trim(f.raw->>'STATUS') <> 'C'
       AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
       AND (v_tipos_dev IS NULL OR f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev))
       AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend)
     GROUP BY 1
  )
  SELECT
    -- bruto (sem balcão)
    round(COALESCE(sum(vp.venda_valor), 0), 2)                                                        AS faturamento,
    round(COALESCE(sum(vp.venda_kg), 0), 3)                                                           AS volume_kg,
    -- líquido = Σ por produto de GREATEST(venda − devolução, 0)
    round(COALESCE(sum(GREATEST(vp.venda_valor - COALESCE(dp.dev_valor, 0), 0)), 0), 2)               AS fat_liq,
    round(COALESCE(sum(GREATEST(vp.venda_kg    - COALESCE(dp.dev_kg, 0),    0)), 0), 3)               AS kg_liq,
    -- com seleção / sem despojo (mantidos, agora sobre a venda sem balcão)
    round(COALESCE(sum(vp.venda_valor_sel), 0), 2)                                                    AS fat_sel,
    round(COALESCE(sum(vp.venda_kg_sel), 0), 3)                                                       AS kg_sel,
    round(COALESCE(sum(vp.venda_valor_carne), 0), 2)                                                  AS fat_carne,
    round(COALESCE(sum(vp.venda_kg_carne), 0), 3)                                                     AS kg_carne
    INTO r
    FROM venda_prod vp LEFT JOIN dev_prod dp ON dp.cod = vp.produto_cod;

  -- clientes / cidades (sobre a venda sem balcão)
  SELECT COUNT(DISTINCT m.cliente_cod),
         COUNT(DISTINCT upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc')))
    INTO v_clientes, v_cidades
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.ind_atak_fato f
           ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
   WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     AND (v_vend IS NULL OR m.vendedor = v_vend)
     AND (v_tipos_venda IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tipos_venda));

  -- DEVOLUÇÃO total (indicador separado — soma cheia, por tipo) e quebra por tipo.
  IF v_tipos_dev IS NOT NULL AND cardinality(v_tipos_dev) > 0 THEN
    WITH d AS (
      SELECT f.raw->>'COD_TIPO_MV' AS cod,
             (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric AS valor,
             CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END AS kg
      FROM public.ind_atak_fato f
      WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
        AND trim(f.raw->>'STATUS') <> 'C'
        AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
        AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev)
        AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend)
    )
    SELECT round(COALESCE(sum(valor), 0), 2), round(COALESCE(sum(kg), 0), 3),
           COALESCE(jsonb_agg(jsonb_build_object('cod', cod, 'valor', valor, 'kg', kg) ORDER BY cod), '[]'::jsonb)
      INTO v_dev_valor, v_dev_kg, v_dev_tipos
      FROM (SELECT cod, round(sum(valor), 2) valor, round(sum(kg), 3) kg FROM d GROUP BY cod) z;
  END IF;

  -- BALCÃO e PERDA (indicadores informativos, fora do faturamento) — do domínio de venda, pelos tipos configurados.
  IF (v_tipos_balcao IS NOT NULL AND cardinality(v_tipos_balcao) > 0)
     OR (v_tipos_perda IS NOT NULL AND cardinality(v_tipos_perda) > 0) THEN
    SELECT round(COALESCE(sum(m.valor) FILTER (WHERE v_tipos_balcao IS NOT NULL AND trim(f.raw->>'COD_TIPO_MV') = ANY (v_tipos_balcao)), 0), 2),
           round(COALESCE(sum(m.kg)    FILTER (WHERE v_tipos_balcao IS NOT NULL AND trim(f.raw->>'COD_TIPO_MV') = ANY (v_tipos_balcao)), 0), 3),
           round(COALESCE(sum(m.valor) FILTER (WHERE v_tipos_perda  IS NOT NULL AND trim(f.raw->>'COD_TIPO_MV') = ANY (v_tipos_perda)),  0), 2),
           round(COALESCE(sum(m.kg)    FILTER (WHERE v_tipos_perda  IS NOT NULL AND trim(f.raw->>'COD_TIPO_MV') = ANY (v_tipos_perda)),  0), 3)
      INTO v_balcao_valor, v_balcao_kg, v_perda_valor, v_perda_kg
      FROM public.bi_comercial_venda_item_mv m
      LEFT JOIN public.ind_atak_fato f
             ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
     WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
       AND (v_vend IS NULL OR m.vendedor = v_vend);
  END IF;

  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', v_clientes, 'cidades', v_cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(v_clientes, 0), 2),
    'faturamento_com_selecao', r.fat_sel,
    'volume_kg_com_selecao', r.kg_sel,
    'ticket_kg_com_selecao', ROUND(r.fat_sel / NULLIF(r.kg_sel, 0), 4),
    'faturamento_sem_despojo', r.fat_carne,
    'volume_kg_sem_despojo', r.kg_carne,
    'ticket_kg_sem_despojo', ROUND(r.fat_carne / NULLIF(r.kg_carne, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'venda_item_sem_balcao',
    -- faturamento líquido (casado por produto, floor) + devolução total (indicador) + tipos de venda aplicados
    'devolucoes_valor',    v_dev_valor,
    'devolucoes_kg',       v_dev_kg,
    'devolucoes_por_tipo', v_dev_tipos,
    'tipos_devolucao',     COALESCE(to_jsonb(v_tipos_dev), '[]'::jsonb),
    'tipos_venda',         COALESCE(to_jsonb(v_tipos_venda), '[]'::jsonb),
    'faturamento_liquido', r.fat_liq,
    'volume_kg_liquido',   r.kg_liq,
    -- balcão / perda: informativos, FORA do faturamento principal
    'venda_balcao', jsonb_build_object('valor', v_balcao_valor, 'kg', v_balcao_kg,
                     'tipos', COALESCE(to_jsonb(v_tipos_balcao), '[]'::jsonb)),
    'perda',        jsonb_build_object('valor', v_perda_valor, 'kg', v_perda_kg,
                     'tipos', COALESCE(to_jsonb(v_tipos_perda), '[]'::jsonb)),
    -- descarte legado (T131 do domínio de devolução; segue como estava)
    'descarte', jsonb_build_object('status', 'aguardando_integracao',
       'tipos', COALESCE(to_jsonb(v_tipos_desc), '[]'::jsonb),
       'total_valor', v_desc_valor, 'total_kg', v_desc_kg,
       'por_produto', v_desc_prod, 'por_vendedor', v_desc_vend, 'por_linha', v_desc_linha));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated, service_role;

-- =====================================================================================
-- 3) fn_bi_comercial_produtos: por produto, bruto + LÍQUIDO (venda − devolução do produto, floor), sem balcão.
--    Mantém a chave 'valor_total' (bruto, para não quebrar a tela) e ACRESCENTA 'valor_liquido' / 'kg_liquido' e
--    'preco_medio_liquido' — a tela mostra o líquido para bater produto a produto com o RMVS713.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_produtos(p_company_id uuid, p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tipos_venda text[]; v_tipos_dev text[];
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_venda FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev   FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');

  RETURN jsonb_build_object('ok', true, 'produtos', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cod_produto', vp.produto_cod,
             'desc_produto', vp.desc_produto,
             'status', COALESCE(vp.clas_status, 'a_classificar'),
             'kg', round(vp.venda_kg, 3),
             'valor_total', round(vp.venda_valor, 2),
             'kg_liquido', round(GREATEST(vp.venda_kg - COALESCE(dp.dev_kg, 0), 0), 3),
             'valor_liquido', round(GREATEST(vp.venda_valor - COALESCE(dp.dev_valor, 0), 0), 2),
             'preco_medio_liquido', ROUND(GREATEST(vp.venda_valor - COALESCE(dp.dev_valor, 0), 0)
                                          / NULLIF(GREATEST(vp.venda_kg - COALESCE(dp.dev_kg, 0), 0), 0), 4))
             ORDER BY GREATEST(vp.venda_valor - COALESCE(dp.dev_valor, 0), 0) DESC NULLS LAST)
      FROM (
        SELECT m.produto_cod, max(m.produto) AS desc_produto, max(c.status) AS clas_status,
               sum(m.kg) AS venda_kg, sum(m.valor) AS venda_valor
          FROM public.bi_comercial_venda_item_mv m
          LEFT JOIN public.ind_atak_fato f
                 ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
          LEFT JOIN public.bi_comercial_produto_classificacao c
                 ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
         WHERE m.company_id = p_company_id AND m.dia BETWEEN p_de AND p_ate
           AND (v_tipos_venda IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tipos_venda))
         GROUP BY m.produto_cod
      ) vp
      LEFT JOIN (
        SELECT trim(f.raw->>'COD_PRODUTO') AS cod,
               sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric) AS dev_valor,
               sum(CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END) AS dev_kg
          FROM public.ind_atak_fato f
         WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao' AND trim(f.raw->>'STATUS') <> 'C'
           AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_de, 'YYYY-MM-DD') AND to_char(p_ate, 'YYYY-MM-DD')
           AND (v_tipos_dev IS NULL OR f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev))
         GROUP BY 1
      ) dp ON dp.cod = vp.produto_cod
  ), '[]'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) TO authenticated, service_role;

-- =====================================================================================
-- 4) Ajuda (RD-95) dos novos indicadores (venda balcão / perda / líquido por produto).
-- =====================================================================================
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('comercial.bi.venda_balcao', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Venda balcão',
   'Nada a preencher: soma das vendas de balcão (tipos 5200/5201) do período, pelos tipos configurados para a empresa.',
   'Separa a venda de balcão do faturamento principal (que usa só as notas de venda), para o painel bater com o relatório do sistema de origem. É informativo, NÃO entra no faturamento líquido.',
   'No período, R$ X em venda balcão — fora do faturamento principal.',
   'Somar o balcão ao faturamento: o alvo do painel é a venda por nota; o balcão fica à parte.',
   'comercial', 18, 'publicado'),
  ('comercial.bi.perda', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Perda',
   'Nada a preencher: soma das notas de perda (tipo 5235) do período. NÃO é venda nem devolução — é perda.',
   'Mede a perda registrada em nota. Fica FORA do faturamento (não é receita) e separada da devolução que abate.',
   'No período, R$ Y em notas de perda.',
   'Confundir perda (5235) com devolução (T582/T583...) — a perda não abate venda, é indicador próprio.',
   'comercial', 19, 'publicado'),
  ('comercial.bi.preco_medio_liquido', '/dashboard/inteligencia/comercial', 'Produtos', 'Preço médio líquido',
   'Nada a preencher: preço médio por kg já líquido de devolução, por produto (faturamento líquido do produto ÷ kg líquido).',
   'Mostra o preço que de fato se realizou por produto, já descontada a devolução daquele produto — para bater produto a produto com o relatório do sistema de origem.',
   'Coxão mole: R$ 8,7 mi líquidos em 233 mil kg ≈ R$ 37/kg líquido.',
   'Comparar o preço médio BRUTO do painel com o líquido do relatório: use o líquido para a conferência.',
   'comercial', 20, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
