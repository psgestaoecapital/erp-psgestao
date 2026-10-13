-- Onda final juiz · Semente de LEADS na Demonstração Revenda (T15 · RD-69, seed único determinístico).
-- fn_demo_seed_revenda_leads: cria alguns leads no CRM da GE (erp_crm_oportunidade) com VEÍCULO DE INTERESSE,
-- espalhados por etapa, para a tela "O que comprar" (T15) mostrar o kanban de leads populado na demo.
-- Auto-resetável (idempotente): apaga os leads/clientes que ELA criou antes de recriar. SECURITY DEFINER sem anon.
-- fn_demo_reset passa a chamá-la para a Revenda e junta a contagem (prova). Autoria = robô (seed), como a garantia.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_revenda_leads(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000003';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_is_demo boolean;
  v_etapas text[] := ARRAY['visita_feita','proposta_enviada','negociacao','ganho'];
  v_nomes  text[] := ARRAY['Marcos A. (demo lead)','Patrícia L. (demo lead)','Rafael S. (demo lead)','Juliana T. (demo lead)'];
  v_rec record; v_i int := 0; v_cli uuid; v_n int := 0;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = p_company;
  IF v_is_demo IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_nao_demo'); END IF;

  -- reset determinístico do que ESTA semente cria (leads e clientes de demonstração)
  DELETE FROM erp_crm_oportunidade WHERE company_id = v_bot AND origem = 'revenda' AND titulo LIKE '%(demo)%';
  DELETE FROM erp_clientes WHERE company_id = v_bot AND nome_fantasia LIKE '%(demo lead)%';

  -- até 4 veículos do pátio da demo viram carro de interesse de um lead, um por etapa
  FOR v_rec IN
    SELECT id, COALESCE(NULLIF(btrim(marca || ' ' || COALESCE(modelo,'')), ''), 'Veículo') AS nome
    FROM veic_veiculo
    WHERE company_id = v_bot AND deleted_at IS NULL AND situacao IN ('disponivel','reservado','em_preparacao')
    ORDER BY created_at NULLS LAST LIMIT 4
  LOOP
    v_i := v_i + 1;
    INSERT INTO erp_clientes (company_id, nome_fantasia) VALUES (v_bot, v_nomes[v_i]) RETURNING id INTO v_cli;
    INSERT INTO erp_crm_oportunidade (company_id, cliente_id, titulo, etapa, origem, veic_interesse_id, created_by)
    VALUES (v_bot, v_cli, v_rec.nome || ' (demo)', v_etapas[v_i], 'revenda', v_rec.id, v_robo);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'leads', v_n, 'etapas', v_etapas[1:v_n]);
END $function$;

-- fn_demo_reset: além da garantia (A), completa a Revenda com os leads (T15) e junta a contagem.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb; v_gar jsonb; v_leads jsonb;
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

  -- Revenda: garantia (A) + leads do CRM (T15). Junta as contagens ao resultado (prova).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_revenda_leads(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_revenda_leads(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid)              TO authenticated, service_role;
