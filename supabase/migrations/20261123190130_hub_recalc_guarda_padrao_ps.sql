-- =====================================================================
-- Hub de Projetos · Guarda no recálculo de custo para serviço da biblioteca padrão PS
-- Code manual (CEO 21/11): fn_projetos_recalcular_custo_servico zera o custo de qualquer serviço sem
-- composição (BOM). Os serviços copiados da biblioteca padrão PS (source_type='padrao_ps', criados por
-- fn_projetos_usar_servico_padrao na migration 20261123190030) NÃO têm BOM e teriam o custo de referência
-- zerado na primeira chamada de recálculo. A guarda abaixo mantém o custo gravado e sai cedo nesse caso.
-- CREATE OR REPLACE do corpo VIVO (pg_get_functiondef) + apenas a guarda logo após a checagem de acesso.
-- Nada mais muda na função.
-- =====================================================================
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

  -- Guarda (Code manual 21/11): serviço vindo da biblioteca padrão PS (source_type='padrao_ps') não tem BOM;
  -- o recálculo normal zeraria o custo de referência copiado. Mantém o custo gravado e sai cedo.
  IF NOT EXISTS (SELECT 1 FROM projetos_servicos_bom WHERE servico_id = p_servico_id)
     AND EXISTS (SELECT 1 FROM projetos_servicos WHERE id = p_servico_id AND source_type = 'padrao_ps') THEN
    RETURN jsonb_build_object('success', true, 'sem_composicao', true,
      'custo_total', (SELECT custo_unitario_total FROM projetos_servicos WHERE id = p_servico_id));
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

-- Guarda de acesso (check-fn-guards regra 1): espelha os grants VIVOS (authenticated + service_role; sem anon).
REVOKE ALL ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_recalcular_custo_servico(uuid) TO authenticated, service_role;
