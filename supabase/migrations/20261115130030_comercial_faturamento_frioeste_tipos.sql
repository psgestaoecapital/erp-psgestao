-- Fórmula FINAL do faturamento do painel comercial (CEO 13/11, contexto 61723f79) — bate com o ATAK (RMVS713).
--
-- DECIFRADO NO DADO (o CEO rodou no SQL Editor — Frioeste 975365cc, ano 2026; o execute_sql do MCP estava fora):
--   · FATURAMENTO (valor) = Σ valor dos tipos (T520, 520)             = R$ 110.508.887  × ATAK R$ 110.360.188 (0,13%).
--   · VOLUME (kg)         = Σ kg dos tipos (T520, 520, T830, T820)    = 5.859.031 kg    × ATAK 5.754.649 (1,8%).
--   · Por vendedor bate < 0,5% (Valcir ≈ R$ 29,3 mi).
--   · FORA do faturamento: 5200/5201 (balcão), 5235 (perda). T830/T820 (despojo/couro) entram só no VOLUME.
--   · A DEVOLUÇÃO (T582-T585, R$ 3.875.239) JÁ VEM EMBUTIDA no valor por produto do RMVS713 — o valor T520+520 do
--     nosso banco já bate com o ATAK SEM descontar de novo. Então o faturamento NÃO desconta devolução outra vez
--     (ela segue como indicador informativo).
--
-- O QUE MUDA (só EXIBIÇÃO/cálculo — a venda bruta armazenada em ind_atak_fato / na MV NÃO é alterada):
--   1) Faturamento (valor) = só os tipos de 'venda_faturamento' (T520, 520).
--   2) Volume (kg)        = os tipos de 'entra_volume' (T520, 520, T830, T820).
--   3) Balcão (5200/5201) e Perda (5235) → indicadores SEPARADOS, fora do faturamento.
--   4) Despojo/couro (T830/T820) → indicador de subprodutos (valor/kg próprios).
--   5) Devolução: indicador informativo; NÃO é descontada do faturamento (já vem embutida por produto na origem).
--   Afeta as abas Produtos, Vendedores e Concentração (RPCs _kpis/_produtos/_ranking_vendedores/_pareto).
--
-- SEGURANÇA DE ESCOPO (RD-102): os tipos são semeados SÓ para a Frioeste (company_id). Empresa sem config de
-- 'venda_faturamento'/'entra_volume' cai no comportamento ATUAL (sem filtro de tipo) — nenhum outro painel muda.
-- O tipo de movimento vem de um join leve na ind_atak_fato pela chave única do item (f.chave_fato = m.fato_id),
-- mesmo padrão já usado em fn_bi_comercial_pareto — a MV não precisa ser reconstruída.
--
-- Aditiva: amplia o CHECK da categoria, semeia tipos (idempotente) e faz CREATE OR REPLACE (só acréscimo/ajuste de
-- leitura) de 4 RPCs. Sem DROP de objeto, sem DELETE/UPDATE em massa, sem tocar dado de cliente.

-- =====================================================================================
-- 1) Categorias de tipo de movimento + config da Frioeste (company-específica; não muda outra empresa). Idempotente.
-- =====================================================================================
ALTER TABLE public.erp_comercial_tipo_movimento
  DROP CONSTRAINT IF EXISTS erp_comercial_tipo_movimento_categoria_check;
ALTER TABLE public.erp_comercial_tipo_movimento
  ADD CONSTRAINT erp_comercial_tipo_movimento_categoria_check
  CHECK (categoria IN ('venda_faturamento','entra_volume','venda_balcao','venda_perda','despojo','devolucao_abate','descarte'));

INSERT INTO public.erp_comercial_tipo_movimento (company_id, categoria, cod_tipo_mv, descricao)
SELECT * FROM (VALUES
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_faturamento', 'T520', 'Venda — compõe o faturamento'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_faturamento', '520',  'Venda — compõe o faturamento'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'entra_volume',      'T520', 'Entra no volume (kg)'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'entra_volume',      '520',  'Entra no volume (kg)'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'entra_volume',      'T830', 'Entra no volume (kg) — despojo/couro'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'entra_volume',      'T820', 'Entra no volume (kg) — despojo/couro'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'despojo',           'T830', 'Despojo / couro (subproduto)'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'despojo',           'T820', 'Despojo / couro (subproduto)'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_balcao',      '5200', 'Venda balcão'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_balcao',      '5201', 'Venda balcão'),
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, 'venda_perda',       '5235', 'Nota de perda')
) AS v(company_id, categoria, cod_tipo_mv, descricao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_comercial_tipo_movimento e
  WHERE e.company_id IS NOT DISTINCT FROM v.company_id
    AND e.categoria = v.categoria AND e.cod_tipo_mv = v.cod_tipo_mv);

-- =====================================================================================
-- 2) fn_bi_comercial_kpis: faturamento = valor dos tipos de faturamento; volume = kg dos tipos de volume;
--    balcão/perda/despojo como indicadores separados; devolução informativa (NÃO descontada). Guarda inalterada.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope jsonb; v_vend text; r RECORD;
  v_tf text[]; v_tv text[]; v_bal text[]; v_perda text[]; v_despojo text[]; v_tipos_dev text[];
  v_dev_valor numeric := 0; v_dev_kg numeric := 0; v_dev_tipos jsonb := '[]'::jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;

  SELECT array_agg(cod_tipo_mv) INTO v_tf      FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_faturamento');
  SELECT array_agg(cod_tipo_mv) INTO v_tv      FROM public.fn_comercial_tipos_efetivos(p_company_id, 'entra_volume');
  SELECT array_agg(cod_tipo_mv) INTO v_bal     FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_balcao');
  SELECT array_agg(cod_tipo_mv) INTO v_perda   FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_perda');
  SELECT array_agg(cod_tipo_mv) INTO v_despojo FROM public.fn_comercial_tipos_efetivos(p_company_id, 'despojo');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');

  WITH itens AS (
    SELECT m.valor, m.kg, m.carne, m.cliente_cod, c.status AS clas_status,
           upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc')) AS cidade_norm,
           trim(f.raw->>'COD_TIPO_MV') AS t
      FROM public.bi_comercial_venda_item_mv m
      LEFT JOIN public.ind_atak_fato f
             ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
      LEFT JOIN public.bi_comercial_produto_classificacao c
             ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
     WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
       AND (v_vend IS NULL OR m.vendedor = v_vend)
  )
  SELECT
    round(COALESCE(sum(valor) FILTER (WHERE v_tf IS NULL OR t = ANY (v_tf)), 0), 2)                                   AS faturamento,
    round(COALESCE(sum(kg)    FILTER (WHERE v_tv IS NULL OR t = ANY (v_tv)), 0), 3)                                   AS volume_kg,
    round(COALESCE(sum(valor) FILTER (WHERE (v_tf IS NULL OR t = ANY (v_tf)) AND clas_status = 'entra'), 0), 2)       AS fat_sel,
    round(COALESCE(sum(kg)    FILTER (WHERE (v_tv IS NULL OR t = ANY (v_tv)) AND clas_status = 'entra'), 0), 3)       AS kg_sel,
    round(COALESCE(sum(valor) FILTER (WHERE (v_tf IS NULL OR t = ANY (v_tf)) AND carne), 0), 2)                       AS fat_carne,
    round(COALESCE(sum(kg)    FILTER (WHERE (v_tv IS NULL OR t = ANY (v_tv)) AND carne), 0), 3)                       AS kg_carne,
    round(COALESCE(sum(valor) FILTER (WHERE v_bal IS NOT NULL AND t = ANY (v_bal)), 0), 2)                           AS balcao_valor,
    round(COALESCE(sum(kg)    FILTER (WHERE v_bal IS NOT NULL AND t = ANY (v_bal)), 0), 3)                           AS balcao_kg,
    round(COALESCE(sum(valor) FILTER (WHERE v_perda IS NOT NULL AND t = ANY (v_perda)), 0), 2)                       AS perda_valor,
    round(COALESCE(sum(kg)    FILTER (WHERE v_perda IS NOT NULL AND t = ANY (v_perda)), 0), 3)                       AS perda_kg,
    round(COALESCE(sum(valor) FILTER (WHERE v_despojo IS NOT NULL AND t = ANY (v_despojo)), 0), 2)                   AS despojo_valor,
    round(COALESCE(sum(kg)    FILTER (WHERE v_despojo IS NOT NULL AND t = ANY (v_despojo)), 0), 3)                   AS despojo_kg,
    COUNT(DISTINCT cliente_cod) FILTER (WHERE v_tf IS NULL OR t = ANY (v_tf))                                        AS clientes,
    COUNT(DISTINCT cidade_norm) FILTER (WHERE v_tf IS NULL OR t = ANY (v_tf))                                        AS cidades
    INTO r
    FROM itens;

  -- Devolução (indicador informativo — NÃO é descontada do faturamento).
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

  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes, 'cidades', r.cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'faturamento_com_selecao', r.fat_sel,
    'volume_kg_com_selecao', r.kg_sel,
    'ticket_kg_com_selecao', ROUND(r.fat_sel / NULLIF(r.kg_sel, 0), 4),
    'faturamento_sem_despojo', r.fat_carne,
    'volume_kg_sem_despojo', r.kg_carne,
    'ticket_kg_sem_despojo', ROUND(r.fat_carne / NULLIF(r.kg_carne, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'faturamento_t520_520',
    -- faturamento líquido = o próprio faturamento (já vem líquido de devolução por produto na origem; NÃO desconta de novo)
    'faturamento_liquido', r.faturamento,
    'volume_kg_liquido',   r.volume_kg,
    'tipos_faturamento',   COALESCE(to_jsonb(v_tf), '[]'::jsonb),
    'tipos_volume',        COALESCE(to_jsonb(v_tv), '[]'::jsonb),
    -- devolução: informativa (não abate; já embutida no valor por produto)
    'devolucoes_valor', v_dev_valor, 'devolucoes_kg', v_dev_kg, 'devolucoes_por_tipo', v_dev_tipos,
    'devolucao_abatida', false, 'tipos_devolucao', COALESCE(to_jsonb(v_tipos_dev), '[]'::jsonb),
    -- indicadores separados, fora do faturamento
    'venda_balcao', jsonb_build_object('valor', r.balcao_valor, 'kg', r.balcao_kg, 'tipos', COALESCE(to_jsonb(v_bal), '[]'::jsonb)),
    'perda',        jsonb_build_object('valor', r.perda_valor, 'kg', r.perda_kg, 'tipos', COALESCE(to_jsonb(v_perda), '[]'::jsonb)),
    'despojo',      jsonb_build_object('valor', r.despojo_valor, 'kg', r.despojo_kg, 'tipos', COALESCE(to_jsonb(v_despojo), '[]'::jsonb)));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated, service_role;

-- =====================================================================================
-- 3) fn_bi_comercial_produtos: por produto, faturamento (valor dos tipos de faturamento) + volume (kg dos de volume).
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_produtos(p_company_id uuid, p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tf text[]; v_tv text[];
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT array_agg(cod_tipo_mv) INTO v_tf FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_faturamento');
  SELECT array_agg(cod_tipo_mv) INTO v_tv FROM public.fn_comercial_tipos_efetivos(p_company_id, 'entra_volume');

  RETURN jsonb_build_object('ok', true, 'produtos', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cod_produto', s.produto_cod, 'desc_produto', s.desc_produto,
             'status', COALESCE(s.clas_status, 'a_classificar'),
             'kg', round(s.kg, 3), 'valor_total', round(s.valor_total, 2))
             ORDER BY s.valor_total DESC NULLS LAST)
      FROM (
        SELECT m.produto_cod, max(m.produto) AS desc_produto, max(c.status) AS clas_status,
               COALESCE(sum(m.kg)    FILTER (WHERE v_tv IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tv)), 0) AS kg,
               COALESCE(sum(m.valor) FILTER (WHERE v_tf IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tf)), 0) AS valor_total
          FROM public.bi_comercial_venda_item_mv m
          LEFT JOIN public.ind_atak_fato f
                 ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
          LEFT JOIN public.bi_comercial_produto_classificacao c
                 ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
         WHERE m.company_id = p_company_id AND m.dia BETWEEN p_de AND p_ate
         GROUP BY m.produto_cod
         HAVING COALESCE(sum(m.valor) FILTER (WHERE v_tf IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tf)), 0) <> 0
             OR COALESCE(sum(m.kg)    FILTER (WHERE v_tv IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tv)), 0) <> 0
      ) s), '[]'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_produtos(uuid, date, date) TO authenticated, service_role;

-- =====================================================================================
-- 4) fn_bi_comercial_ranking_vendedores: faturamento por vendedor pelos tipos de faturamento (volume pelos de volume).
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_ranking_vendedores(p_company_id uuid, p_dt_ini date, p_dt_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_out jsonb; v_tf text[]; v_tv text[];
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' <> 'lider' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  SELECT array_agg(cod_tipo_mv) INTO v_tf FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_faturamento');
  SELECT array_agg(cod_tipo_mv) INTO v_tv FROM public.fn_comercial_tipos_efetivos(p_company_id, 'entra_volume');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cod_vend_comp', r.cod, 'vendedor', COALESCE(r.nome, r.cod), 'volume_kg', r.vol, 'faturamento', r.fat,
      'clientes', r.cli, 'lucro', NULL, 'margem_pct', NULL) ORDER BY r.fat DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT m.vendedor AS cod,
           (SELECT h.raw->>'Apelido' FROM public.ind_atak_fato h
             WHERE h.company_id = p_company_id AND h.dominio = 'comercial_hierarquia' AND h.raw->>'Cod_cadastro' = m.vendedor LIMIT 1) AS nome,
           COALESCE(sum(m.kg)    FILTER (WHERE v_tv IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tv)), 0) AS vol,
           COALESCE(sum(m.valor) FILTER (WHERE v_tf IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tf)), 0) AS fat,
           COUNT(DISTINCT m.cliente_cod) FILTER (WHERE v_tf IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tf)) AS cli
      FROM public.bi_comercial_venda_item_mv m
      LEFT JOIN public.ind_atak_fato f
             ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
     WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     GROUP BY m.vendedor
  ) r
  WHERE r.fat <> 0 OR r.vol <> 0;
  RETURN jsonb_build_object('ok', true, 'ranking', v_out, 'lucro_status', 'aguardando_dado_confiavel');
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_ranking_vendedores(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_vendedores(uuid, date, date) TO authenticated, service_role;

-- =====================================================================================
-- 5) fn_bi_comercial_pareto: a dimensão por valor usa o faturamento (tipos de faturamento), para a Concentração bater.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_pareto(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_dimensao text DEFAULT 'cliente'::text, p_vendedor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_vend text; v_dim text; v_out jsonb; v_tf text[];
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  v_dim := lower(COALESCE(p_dimensao, 'cliente'));
  SELECT array_agg(cod_tipo_mv) INTO v_tf FROM public.fn_comercial_tipos_efetivos(p_company_id, 'venda_faturamento');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rotulo', rotulo, 'valor', valor, 'pct', pct, 'pct_acumulado', pct_acum) ORDER BY valor DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT rotulo, valor,
           ROUND(valor / NULLIF(SUM(valor) OVER (), 0) * 100, 2) AS pct,
           ROUND(SUM(valor) OVER (ORDER BY valor DESC ROWS UNBOUNDED PRECEDING) / NULLIF(SUM(valor) OVER (), 0) * 100, 2) AS pct_acum
    FROM (
      SELECT COALESCE(NULLIF(btrim(g.rot), ''), '(sem)') AS rotulo, SUM(g.valor) AS valor
        FROM (
          SELECT CASE v_dim
                   WHEN 'vendedor' THEN m.vendedor
                   WHEN 'filial' THEN f.raw->>'COD_FILIAL'
                   WHEN 'supervisor' THEN (SELECT h.raw->>'Subordinado_a_Nome' FROM public.ind_atak_fato h
                                            WHERE h.company_id = m.company_id AND h.dominio = 'comercial_hierarquia'
                                              AND h.raw->>'Cod_cadastro' = m.vendedor LIMIT 1)
                   ELSE f.raw->>'APELIDO'
                 END AS rot,
                 m.valor AS valor
            FROM public.bi_comercial_venda_item_mv m
            LEFT JOIN public.ind_atak_fato f ON f.company_id = m.company_id AND f.dominio = 'comercial_venda_item' AND f.chave_fato = m.fato_id
           WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
             AND (v_vend IS NULL OR m.vendedor = v_vend)
             AND (v_tf IS NULL OR trim(f.raw->>'COD_TIPO_MV') = ANY (v_tf))
        ) g
       GROUP BY 1
    ) agg
  ) p;
  RETURN jsonb_build_object('ok', true, 'dimensao', v_dim, 'itens', v_out);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) TO authenticated, service_role;

-- =====================================================================================
-- 6) Ajuda (RD-95) dos novos indicadores separados.
-- =====================================================================================
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('comercial.bi.venda_balcao', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Venda balcão',
   'Nada a preencher: soma das vendas de balcão (tipos 5200/5201), pelos tipos configurados para a empresa.',
   'Separa a venda de balcão do faturamento principal (notas de venda), para o painel bater com o relatório do sistema de origem. É informativo, NÃO entra no faturamento.',
   'No período, R$ X em venda balcão — fora do faturamento principal.',
   'Somar o balcão ao faturamento: o faturamento é a venda por nota; o balcão fica à parte.',
   'comercial', 18, 'publicado'),
  ('comercial.bi.perda', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Perda',
   'Nada a preencher: soma das notas de perda (tipo 5235). NÃO é venda nem devolução.',
   'Mede a perda registrada em nota. Fica FORA do faturamento (não é receita).',
   'No período, R$ Y em notas de perda.',
   'Confundir perda (5235) com devolução — a perda não é venda nem abate; é indicador próprio.',
   'comercial', 19, 'publicado'),
  ('comercial.bi.despojo', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Despojo / couro',
   'Nada a preencher: subprodutos (tipos T830/T820). Entram no VOLUME (kg), mas têm valor próprio, separado do faturamento de carne.',
   'Mostra o peso e o valor de despojo/couro, para o volume total bater com o relatório sem inflar o faturamento de carne.',
   'No período, Z mil kg de despojo/couro com valor próprio.',
   'Somar o valor do despojo ao faturamento de carne: o despojo tem card próprio; no volume ele entra, no valor principal não.',
   'comercial', 21, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
