-- conserto-main (gilberto-esteira) · 18/11/2026
-- @pos-migration VERMELHO na main: e2e/jornadas/aceitacao/bom-estoque-local-epi-manual.spec.ts
-- CAUSA (RD-38, provado no dado): erp_produtos.preco_custo_medio tem DEFAULT 0 e é NULL-able; as 3 funções de custo
--   do BOM (#5517, migration 20261120160030) usam COALESCE(preco_custo_medio, preco_custo, 0). Para um produto que
--   ainda NÃO teve movimento de estoque (preco_custo_medio = 0, mas preco_custo informado), o COALESCE devolve 0 e
--   ZERA o custo do produto no BOM. O spec cria produtos só com preco_custo (10 e 8) e espera material = 43; com o
--   bug vinha 15. A convenção do sistema é "custo médio quando houver; senão, custo padrão" — o 0 default quebra isso.
-- FIX cirúrgico e ADITIVO em comportamento: COALESCE(NULLIF(preco_custo_medio, 0), preco_custo, 0). Quando há médio
--   real (> 0) usa o médio; quando é 0/nulo cai para o preco_custo. NÃO toca guarda de acesso, RLS, nem schema.
-- ESCOPO: SÓ as 3 funções do BOM de projetos (#5517). As demais funções do sistema que usam o mesmo COALESCE
--   (fn_faturar, fn_balanco_patrimonial, fn_compra_receber, etc. — financeiro/fiscal) NÃO são tocadas aqui.
-- Prova antes/depois no PR. Idempotente (CREATE OR REPLACE).

-- 1) custo por LINHA do BOM (cache da grade)
CREATE OR REPLACE FUNCTION public.fn_projetos_atualizar_cache_bom(p_servico_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_publico boolean;
BEGIN
  SELECT company_id, coalesce(is_publico, false) INTO v_company, v_publico FROM projetos_servicos WHERE id = p_servico_id;
  IF v_company IS NULL THEN RETURN; END IF;  -- serviço inexistente (ex.: cascade de exclusão): nada a fazer
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = '' OR is_admin()
          OR v_publico OR v_company IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso ao serviço' USING ERRCODE = '42501';
  END IF;

  UPDATE projetos_servicos_bom bom
  SET custo_unitario = src.cu,
      custo_total = bom.quantidade
                    * (CASE WHEN bom.tipo = 'mao_obra' THEN 1 ELSE (1 + COALESCE(bom.perda_pct, 0)/100) END)
                    * src.cu
  FROM (
    SELECT b.id,
      CASE
        WHEN b.mao_obra_id IS NOT NULL      THEN COALESCE(mo.custo_hora, 0)
        WHEN b.produto_id IS NOT NULL       THEN COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)
        WHEN b.insumo_id IS NOT NULL        THEN COALESCE(i.current_cost, 0)
        WHEN b.item_nome_manual IS NOT NULL THEN COALESCE(b.custo_unitario_manual, 0)
        ELSE 0
      END AS cu
    FROM projetos_servicos_bom b
    LEFT JOIN m16_insumos i       ON i.id = b.insumo_id
    LEFT JOIN projetos_mao_obra mo ON mo.id = b.mao_obra_id
    LEFT JOIN erp_produtos p       ON p.id = b.produto_id
    WHERE b.servico_id = p_servico_id
  ) src
  WHERE bom.id = src.id AND bom.servico_id = p_servico_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_atualizar_cache_bom(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_atualizar_cache_bom(uuid) TO authenticated, service_role;

-- 2) custo TOTAL do serviço (todas as fontes; EPI entra no material)
CREATE OR REPLACE FUNCTION public.fn_projetos_recalcular_custo_servico(p_servico_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_company uuid;
  v_publico boolean;
  v_material numeric(12,2);
  v_mao_obra numeric(12,2);
  v_equip numeric(12,2);
  v_total numeric(12,2);
BEGIN
  SELECT company_id, coalesce(is_publico, false) INTO v_company, v_publico FROM projetos_servicos WHERE id = p_servico_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('success', true, 'custo_total', 0); END IF;
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = '' OR is_admin()
          OR v_publico OR v_company IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso ao serviço' USING ERRCODE = '42501';
  END IF;

  WITH linhas AS (
    SELECT bom.tipo, bom.quantidade, COALESCE(bom.perda_pct, 0) AS perda,
      CASE
        WHEN bom.mao_obra_id IS NOT NULL      THEN COALESCE(mo.custo_hora, 0)
        WHEN bom.produto_id IS NOT NULL       THEN COALESCE(NULLIF(p.preco_custo_medio, 0), p.preco_custo, 0)
        WHEN bom.insumo_id IS NOT NULL        THEN COALESCE(i.current_cost, 0)
        WHEN bom.item_nome_manual IS NOT NULL THEN COALESCE(bom.custo_unitario_manual, 0)
        ELSE 0
      END AS cu,
      (bom.insumo_id IS NOT NULL AND COALESCE(i.category, '') = 'EQUIP') AS legado_equip
    FROM projetos_servicos_bom bom
    LEFT JOIN m16_insumos i       ON i.id = bom.insumo_id
    LEFT JOIN projetos_mao_obra mo ON mo.id = bom.mao_obra_id
    LEFT JOIN erp_produtos p       ON p.id = bom.produto_id
    WHERE bom.servico_id = p_servico_id
  )
  SELECT
    COALESCE(SUM(CASE WHEN (tipo = 'insumo' AND NOT legado_equip) OR tipo = 'epi' THEN quantidade * (1 + perda/100) * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'mao_obra' THEN quantidade * cu END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'equipamento' OR (tipo = 'insumo' AND legado_equip) THEN quantidade * (1 + perda/100) * cu END), 0)
  INTO v_material, v_mao_obra, v_equip
  FROM linhas;

  v_total := v_material + v_mao_obra + v_equip;

  UPDATE projetos_servicos
  SET custo_material = v_material, custo_mao_obra = v_mao_obra, custo_equipamento = v_equip,
      custo_unitario_total = v_total, updated_at = now()
  WHERE id = p_servico_id;

  RETURN jsonb_build_object('success', true, 'custo_total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) TO authenticated, service_role;

-- 3) fontes do estoque para o modal "Adicionar item" (custo mostrado ao usuário)
CREATE OR REPLACE FUNCTION public.fn_bom_estoque_fontes(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_produtos jsonb;
  v_locais jsonb;
  v_mapa jsonb;
BEGIN
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'codigo', codigo, 'nome', nome, 'unidade', unidade,
           'custo', COALESCE(NULLIF(preco_custo_medio, 0), preco_custo)) ORDER BY nome), '[]'::jsonb)
    INTO v_produtos
    FROM public.erp_produtos
   WHERE company_id = p_company_id AND ativo AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ativo', ativo)
           ORDER BY ativo DESC, nome), '[]'::jsonb)
    INTO v_locais
    FROM public.erp_estoque_locais
   WHERE company_id = p_company_id;

  SELECT COALESCE(jsonb_object_agg(produto_id, locais), '{}'::jsonb) INTO v_mapa FROM (
    SELECT produto_id, jsonb_agg(DISTINCT local_id) AS locais
    FROM public.erp_estoque_movimentacoes
    WHERE company_id = p_company_id AND produto_id IS NOT NULL AND local_id IS NOT NULL
    GROUP BY produto_id
  ) t;

  RETURN jsonb_build_object('ok', true, 'produtos', v_produtos, 'locais', v_locais, 'produto_locais', v_mapa);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bom_estoque_fontes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bom_estoque_fontes(uuid) TO authenticated, service_role;
