-- 🚨 MENU VAZIO (CEO 28/09: "cliente sem menu no celular é cliente parado").
--
-- Causa (provada no dado): o menu lateral/gaveta vem de fn_modulos_sidebar_por_area, que só lista módulo PAGO
-- (tenant_subscriptions ativa → plan_catalog → plan_modules). Três empresas de DEMONSTRAÇÃO nunca ganharam plano:
--   Oficina - DEMO (b0700000-…-001), Agência (P&M) - DEMO (…-002) e Mecânica Modelo - DEMO (ded00000-…-001).
-- Resultado: menu com 0/1 item em QUALQUER tela (celular e desktop) — não é permissão nem RLS (a função é
-- SECURITY DEFINER) e não vem das PRs de segurança. Revenda (19/09), GE (26/09) e SST (27/09) já tinham o plano
-- criado pela migration de cada demo; Oficina e Agência ficaram de fora.
-- Clientes reais: 0 afetados — todo par usuário×área visível (fn_listar_areas_visiveis) tem menu com ≥ 6 itens.
--
-- (1) fn_demo_garantir_plano(company): plano completo R$ 0 da vertical, SÓ para is_demo (nenhuma empresa real muda de
--     plano; demos ficam fora do MRR por fn_empresas_produtivas). Mesmo padrão de 20260926300000 (GE Pro).
-- (2) fn_demo_reset passa a chamar (1) — a demo não volta a ficar sem menu depois de um reset (RD-69).
-- (3) fn_menu_vazio_auditar(): vigia sozinho — acusa empresa real com área visível e menu vazio, e demo sem menu na
--     área dela (vazio ou com menos de 3 itens — a Agência tinha só 1). Entra no briefing (chave menu_vazio + alertas_pendentes_para_ceo.menu_vazio).

CREATE OR REPLACE FUNCTION public.fn_demo_garantir_plano(p_company_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_plano text; v_tier text; v_acao text := 'ja_tinha';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;
  SELECT m.plano, m.tier INTO v_plano, v_tier FROM (VALUES
    ('b0700000-0000-4000-a000-000000000001'::uuid, 'v15_oficina_grande', 'grande'),
    ('b0700000-0000-4000-a000-000000000002'::uuid, 'v15_pm_grande', 'grande'),
    ('b0700000-0000-4000-a000-000000000003'::uuid, 'v15_revenda', NULL),
    ('b0700000-0000-4000-a000-000000000004'::uuid, 'v15_gestao_empresarial_pro', 'pro'),
    ('b0700000-0000-4000-a000-000000000005'::uuid, 'v15_compliance', NULL),
    ('ded00000-0000-4000-a000-000000000001'::uuid, 'v15_oficina_grande', 'grande')) AS m(cid, plano, tier)
  WHERE m.cid = p_company_id;
  IF v_plano IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'demo_sem_plano_mapeado'); END IF;

  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = v_plano AND status = 'active') THEN
    IF EXISTS (SELECT 1 FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = v_plano) THEN
      -- reativa a linha existente (a mais recente); UNIQUE(company_id, plan_id, status) impede duas 'active'
      UPDATE tenant_subscriptions SET status = 'active', monthly_price_brl = 0, cancelled_at = NULL, suspended_at = NULL, updated_at = now()
       WHERE id = (SELECT id FROM tenant_subscriptions WHERE company_id = p_company_id AND plan_id = v_plano
                    ORDER BY updated_at DESC NULLS LAST LIMIT 1);
      v_acao := 'reativado';
    ELSE
      INSERT INTO tenant_subscriptions (company_id, plan_id, status, monthly_price_brl, billing_cycle, tier, observacao)
      VALUES (p_company_id, v_plano, 'active', 0, 'monthly', v_tier, 'Demonstração · plano completo R$ 0 (menu vazio 28/09)');
      v_acao := 'criado';
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'plano', v_plano, 'acao', v_acao);
END $$;
REVOKE ALL ON FUNCTION public.fn_demo_garantir_plano(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_garantir_plano(uuid) TO service_role;

-- aplica agora nas 6 demos (idempotente; as que já têm plano ficam como estão)
DO $$
DECLARE c uuid; r jsonb;
BEGIN
  FOREACH c IN ARRAY ARRAY['b0700000-0000-4000-a000-000000000001','b0700000-0000-4000-a000-000000000002',
    'b0700000-0000-4000-a000-000000000003','b0700000-0000-4000-a000-000000000004','b0700000-0000-4000-a000-000000000005',
    'ded00000-0000-4000-a000-000000000001']::uuid[] LOOP
    IF EXISTS (SELECT 1 FROM companies WHERE id = c) THEN
      r := public.fn_demo_garantir_plano(c);
      RAISE NOTICE 'demo % → %', c, r;
    END IF;
  END LOOP;
END $$;

-- (2) reset mantém o plano (patch por âncora, corpo vigente preservado)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_reset(uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_demo_garantir_plano' THEN
    v_new := replace(v_def, E'  RETURN jsonb_build_object(''ok'', true, ''empresa'', v_nome,',
      E'  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)\n'
      || E'  v_res := COALESCE(v_res, ''{}''::jsonb) || jsonb_build_object(''plano'', public.fn_demo_garantir_plano(p_company_id));\n\n'
      || E'  RETURN jsonb_build_object(''ok'', true, ''empresa'', v_nome,');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_reset: ancora RETURN ok nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

-- (3) vigia: menu vazio
CREATE OR REPLACE FUNCTION public.fn_menu_vazio_auditar() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH pares AS (
    SELECT DISTINCT uc.company_id, uc.user_id
    FROM user_companies uc
    JOIN users u ON u.id = uc.user_id AND u.system_role IS NULL AND coalesce(u.is_active, true)
    JOIN companies c ON c.id = uc.company_id AND NOT coalesce(c.is_demo, false)
  ),
  reais AS (
    SELECT p.company_id, p.user_id, v.area_slug area FROM pares p, LATERAL fn_listar_areas_visiveis(p.company_id, p.user_id) v
  ),
  demos AS (
    SELECT d.cid company_id, '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'::uuid user_id, d.area FROM (VALUES
      ('b0700000-0000-4000-a000-000000000001'::uuid, 'oficina'),
      ('b0700000-0000-4000-a000-000000000002'::uuid, 'pm'),
      ('b0700000-0000-4000-a000-000000000003'::uuid, 'revenda_veiculos'),
      ('b0700000-0000-4000-a000-000000000004'::uuid, 'gestao_empresarial'),
      ('b0700000-0000-4000-a000-000000000005'::uuid, 'compliance'),
      ('ded00000-0000-4000-a000-000000000001'::uuid, 'oficina')) AS d(cid, area)
    WHERE EXISTS (SELECT 1 FROM companies WHERE id = d.cid)
  ),
  contagem AS (
    SELECT 'cliente' tipo, r.*, (SELECT count(*) FROM fn_modulos_sidebar_por_area(r.area, r.company_id, r.user_id)) itens FROM reais r
    UNION ALL
    SELECT 'demo', d.*, (SELECT count(*) FROM fn_modulos_sidebar_por_area(d.area, d.company_id, d.user_id)) FROM demos d
  ),
  vazios AS (SELECT * FROM contagem WHERE itens < 3)  -- vazio ou quase (menor menu real hoje: 6 itens)
  SELECT jsonb_build_object(
    'ok', NOT EXISTS (SELECT 1 FROM vazios),
    'total_achados', (SELECT count(*) FROM vazios),
    'clientes', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('empresa', coalesce(c.nome_fantasia, c.razao_social), 'area', v.area, 'itens', v.itens)), '[]')
                   FROM vazios v JOIN companies c ON c.id = v.company_id WHERE v.tipo = 'cliente'),
    'demos', (SELECT coalesce(jsonb_agg(jsonb_build_object('empresa', coalesce(c.nome_fantasia, c.razao_social), 'area', v.area, 'itens', v.itens)), '[]')
                FROM vazios v JOIN companies c ON c.id = v.company_id WHERE v.tipo = 'demo'),
    'regra', 'Área que o usuário vê tem que ter menu (vazio ou < 3 itens é achado). Menu vem só de módulo pago (tenant_subscriptions ativa). Achado aqui = cliente parado.')
$$;
REVOKE ALL ON FUNCTION public.fn_menu_vazio_auditar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_menu_vazio_auditar() TO service_role;

DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'fn_briefing_sessao';
  IF v_def !~ 'fn_menu_vazio_auditar' THEN
    v_new := replace(v_def, E'  RETURN v_result;\nEND;',
      E'  -- 28/09: menu vazio — área visível sem nenhum item no menu (cliente parado)\n'
      || E'  v_result := v_result || jsonb_build_object(''menu_vazio'', public.fn_menu_vazio_auditar());\n'
      || E'  IF NOT coalesce((v_result->''menu_vazio''->>''ok'')::boolean, true) THEN\n'
      || E'    v_result := jsonb_set(v_result, ''{alertas_pendentes_para_ceo,menu_vazio}'', jsonb_build_object(\n'
      || E'      ''total_achados'', v_result->''menu_vazio''->''total_achados'',\n'
      || E'      ''acao'', ''Cliente sem menu é cliente parado: ver menu_vazio (plano/assinatura da empresa)''), true);\n'
      || E'  END IF;\n'
      || E'  RETURN v_result;\nEND;');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora RETURN v_result nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

REVOKE ALL ON FUNCTION public.fn_briefing_sessao() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_briefing_sessao() TO service_role;
