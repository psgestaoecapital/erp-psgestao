-- Chamado #11676 (tryogessos.engenharia) · /dashboard/projetos/catalogo
-- BUG: "preço de venda só está fazendo o cálculo com o valor da mão de obra e não
--       valor global do serviço".
--
-- Causa-raiz provada no dado (RD-38): a precificação de material
-- (fn_precificar_montagem_material) somava o custo APENAS das linhas de BOM com
-- b.tipo='insumo' ligadas ao catálogo m16_insumos (b.insumo_id). Quando o material
-- da composição vem do ESTOQUE REAL (erp_produtos, via b.produto_id) ou de item
-- MANUAL (b.item_nome_manual), o JOIN em m16_insumos descartava todas as linhas →
-- custo_material = 0 → venda_material = 0 → o preço de venda saía só com a mão de obra.
-- Prova (tryogessos, company 918c3ea4-...): 68 linhas de material, todas via
-- erp_produtos com custo > 0, somando R$ 301,83 de material IGNORADO pelo motor.
--
-- O detalhe da composição (fn_servico_composicao_detalhe) JÁ soma os três (m16,
-- produtos e manual) no bucket "material". Esta correção alinha a precificação ao
-- MESMO conjunto do bucket de material, sem tocar em dado de cliente.
--
-- Aditiva/idempotente: só CREATE OR REPLACE da função (lógica de leitura). Para
-- empresas cujo material já vinha de m16_insumos (b.insumo_id) o resultado é
-- IDÊNTICO (a fórmula do custo_item por linha é a mesma); muda apenas para quem usa
-- produto de estoque / item manual, que antes somava zero.

CREATE OR REPLACE FUNCTION public.fn_precificar_montagem_material(p_servico_id uuid, p_company_id uuid, p_business_line_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg RECORD;
  v_custo_material numeric := 0;
  v_custo_capado numeric;
  v_impostos numeric;
  v_margem numeric;
  v_venda numeric;
  v_itens jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  SELECT * INTO v_cfg FROM erp_precificacao_config
   WHERE company_id = p_company_id AND ativo
     AND (business_line_id = p_business_line_id OR business_line_id IS NULL)
   ORDER BY (business_line_id = p_business_line_id) DESC NULLS LAST, vigencia_inicio DESC
   LIMIT 1;
  IF v_cfg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_config_precificacao');
  END IF;

  -- Custo de material = bucket "material" da composição (não equipamento/epi/ferramenta/mão de obra),
  -- vindo de TRÊS fontes: m16_insumos (b.insumo_id), estoque real (erp_produtos, b.produto_id) e item manual.
  WITH mat AS (
    -- m16 insumos (exclui os reclassificados como equipamento pelo category legado)
    SELECT b.ordem, i.name AS insumo, b.quantidade, b.perda_pct,
           COALESCE(i.current_cost,0)::numeric AS custo_unit,
           round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(i.current_cost,0), 4) AS custo_item
      FROM projetos_servicos_bom b
      JOIN m16_insumos i ON i.id = b.insumo_id
     WHERE b.servico_id = p_servico_id
       AND b.insumo_id IS NOT NULL
       AND b.tipo NOT IN ('equipamento','epi','ferramenta','mao_obra')
       AND upper(COALESCE(i.category,'')) NOT LIKE '%EQUIP%'
    UNION ALL
    -- produto do estoque real (erp_produtos) — custo médio, senão custo de compra
    SELECT b.ordem, p.nome, b.quantidade, b.perda_pct,
           COALESCE(NULLIF(p.preco_custo_medio,0), p.preco_custo, 0)::numeric,
           round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(NULLIF(p.preco_custo_medio,0), p.preco_custo, 0), 4)
      FROM projetos_servicos_bom b
      JOIN erp_produtos p ON p.id = b.produto_id
     WHERE b.servico_id = p_servico_id
       AND b.produto_id IS NOT NULL
       AND b.tipo NOT IN ('equipamento','epi','ferramenta','mao_obra')
    UNION ALL
    -- item manual de material (custo congelado)
    SELECT b.ordem, b.item_nome_manual, b.quantidade, b.perda_pct,
           COALESCE(b.custo_unitario_manual,0)::numeric,
           round(b.quantidade * (1 + COALESCE(b.perda_pct,0)/100.0) * COALESCE(b.custo_unitario_manual,0), 4)
      FROM projetos_servicos_bom b
     WHERE b.servico_id = p_servico_id
       AND b.insumo_id IS NULL AND b.produto_id IS NULL AND b.mao_obra_id IS NULL
       AND b.item_nome_manual IS NOT NULL
       AND b.tipo NOT IN ('equipamento','epi','ferramenta','mao_obra')
  )
  SELECT
    COALESCE(SUM(custo_item), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'insumo', insumo, 'qtd_m2', quantidade, 'perda_pct', perda_pct,
      'custo_unit', custo_unit,
      'custo_item', round(custo_item, 4)
    ) ORDER BY ordem), '[]'::jsonb)
  INTO v_custo_material, v_itens
  FROM mat;

  v_custo_capado := v_custo_material * (1 - COALESCE(v_cfg.creditos_pct,0)/100.0);
  v_impostos := v_custo_capado * (COALESCE(v_cfg.icms_pct,0) + COALESCE(v_cfg.pis_cofins_pct,0))/100.0;
  v_margem := (v_custo_capado + v_impostos) * COALESCE(v_cfg.margem_material_pct,0)/100.0;
  v_venda := v_custo_capado + v_impostos + v_margem;

  RETURN jsonb_build_object(
    'ok', true,
    'servico_id', p_servico_id,
    'config', jsonb_build_object('creditos_pct', v_cfg.creditos_pct, 'icms_pct', v_cfg.icms_pct,
       'pis_cofins_pct', v_cfg.pis_cofins_pct, 'margem_material_pct', v_cfg.margem_material_pct,
       'linha', v_cfg.business_line_id),
    'custo_material', round(v_custo_material, 2),
    'custo_capado',   round(v_custo_capado, 2),
    'impostos_saida', round(v_impostos, 2),
    'margem_material',round(v_margem, 2),
    'venda_material', round(v_venda, 2),
    'metodo_imposto', 'por_fora',
    'itens', v_itens
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_precificar_montagem_material(uuid,uuid,uuid) FROM anon;
