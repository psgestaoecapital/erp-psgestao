-- Onda final A · Semente da Garantia na Demonstração Revenda (RD-69: seed único, determinístico).
-- fn_demo_seed_revenda_garantia: em 2 vendas da demo cria 2 garantias (1 em vigência, 1 vencida) e 1
-- acionamento com OS (reusa a OS da Oficina) cujo custo cai em veic_custo(os_id) → entra no lucro real
-- da venda por fn_veic_conta_do_carro. É auto-resetável (idempotente): apaga o que semeou antes de semear.
-- fn_demo_reset passa a chamá-la para a Revenda e devolve a contagem (prova). SECURITY DEFINER sem anon.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_revenda_garantia(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000003';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_is_demo boolean;
  v_v1 uuid; v_ve1 uuid;   -- venda vigente + veículo
  v_v2 uuid; v_ve2 uuid;   -- venda vencida + veículo
  v_g1 uuid; v_g2 uuid; v_os uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = p_company;
  IF v_is_demo IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_nao_demo'); END IF;

  -- reset determinístico do que ESTA semente cria (custo da garantia, acionamentos, garantias, OS de garantia)
  DELETE FROM veic_custo WHERE company_id = v_bot AND descricao LIKE 'Garantia (demo)%';
  DELETE FROM veic_garantia_acionamento WHERE company_id = v_bot;
  DELETE FROM veic_garantia WHERE company_id = v_bot;
  DELETE FROM erp_os WHERE company_id = v_bot AND numero LIKE 'GAR-DEMO-%';

  -- vendas alvo (nascem do seed principal): DEMO-V-0006 (entregue) e DEMO-V-0007 (faturada)
  SELECT id, veiculo_id INTO v_v1, v_ve1 FROM veic_venda WHERE company_id = v_bot AND numero = 'DEMO-V-0006' AND deleted_at IS NULL LIMIT 1;
  SELECT id, veiculo_id INTO v_v2, v_ve2 FROM veic_venda WHERE company_id = v_bot AND numero = 'DEMO-V-0007' AND deleted_at IS NULL LIMIT 1;
  IF v_v1 IS NULL OR v_v2 IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vendas_demo_ausentes', 'nota', 'rode fn_gold_revenda_seed_reparar antes'); END IF;

  -- Garantia 1 — EM VIGÊNCIA (12 meses / 10.000 km)
  INSERT INTO veic_garantia (company_id, venda_id, veiculo_id, prazo_meses, km_limite, termo_md, provisao_ativa, provisao_valor, status, created_by)
  VALUES (v_bot, v_v1, v_ve1, 12, 10000, 'Garantia de motor e câmbio — 12 meses ou 10.000 km (demonstração).', false, 0, 'ativa', v_robo)
  RETURNING id INTO v_g1;

  -- Garantia 2 — VENCIDA (3 meses, já expirada)
  INSERT INTO veic_garantia (company_id, venda_id, veiculo_id, prazo_meses, km_limite, termo_md, provisao_ativa, provisao_valor, status, created_by)
  VALUES (v_bot, v_v2, v_ve2, 3, 5000, 'Garantia de 3 meses (demonstração) — já vencida.', false, 0, 'vencida', v_robo)
  RETURNING id INTO v_g2;

  -- Acionamento na garantia vigente: abre OS (reuso da Oficina) + custo que cai no veículo/lucro da venda
  INSERT INTO erp_os (company_id, numero, descricao_servico, status, prioridade, data_abertura, veic_veiculo_id, total, created_by)
  VALUES (v_bot, 'GAR-DEMO-0001', 'Garantia (demo) — troca de sensor sob garantia', 'aberta', 'alta', current_date - 5, v_ve1, 800, v_robo)
  RETURNING id INTO v_os;
  INSERT INTO veic_garantia_acionamento (company_id, garantia_id, os_id, descricao, created_by)
  VALUES (v_bot, v_g1, v_os, 'Cliente relatou luz de injeção — troca de sensor.', v_robo);
  -- categoria 'preparacao' (o acionamento reusa a OS de preparação; 'garantia' não é categoria válida em veic_custo)
  INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, data_custo, entra_base_fiscal, os_id, created_by)
  VALUES (v_bot, v_ve1, 'preparacao', 'Garantia (demo) — peça + mão de obra do acionamento', 800, current_date - 5, false, v_os, v_robo);

  RETURN jsonb_build_object('ok', true, 'garantias', 2, 'em_vigencia', 1, 'vencidas', 1,
    'acionamentos', 1, 'custo_acionamento', 800);
END $function$;

-- fn_demo_reset passa a completar a Revenda com a garantia (seed único, RD-69) e devolve a contagem.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb; v_gar jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  -- Revenda: completa a demo com a garantia (2 garantias + 1 acionamento com OS/custo) e junta a contagem.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_revenda_garantia(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid)                 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_revenda_garantia(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid)                 TO authenticated, service_role;
