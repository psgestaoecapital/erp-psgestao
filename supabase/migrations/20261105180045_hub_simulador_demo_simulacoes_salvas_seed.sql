-- Hub · Simulador de montagens (/dashboard/projetos/simulador) — PDCA RD-98 p1 "sem tela morta".
-- GAP: a empresa DEMO da construtora (006) tinha 0 simulações salvas, então o bloco "Simulações
-- salvas" aparecia VAZIO na vitrine. Correção: semear 2–3 simulações REAIS pelo fluxo real
-- (fn_simulador_salvar recalcula no servidor via fn_simular_montagem — nada de mockup/valor fixo),
-- e incluir o seed no fn_demo_reset da 006 para sobreviver ao reset / montar-banco-testes.
-- ADITIVA: 1 função nova + CREATE OR REPLACE de fn_demo_reset acrescentando 1 bloco para a 006.
-- Nunca apaga/altera dado de cliente: a função só roda em empresa is_demo=true e só mexe na
-- própria erp_hub_simulacao da DEMO. RD-38 provado na PR (no dado: fn_simular_montagem = ok=true
-- para os 3 serviços, totais reais; idempotente: roda 2× e mantém 3 linhas).

-- 1) Seed das simulações salvas da construtora DEMO, pelo fluxo real --------------------------
-- ci-sem-guarda: fn_demo_seed_construtora_simulacoes — só empresa is_demo (service_role), roda pelo fn_demo_reset; as gravações passam por fn_simulador_salvar (que já chama fn__guarda_empresa).
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_simulacoes(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_is_demo  boolean;
  v_user     uuid;
  v_claim_old text;
  v_n        int := 0;
  v_sid      uuid;
  rec        record;
BEGIN
  -- trava de segurança: só empresa DEMO
  SELECT is_demo INTO v_is_demo FROM public.companies WHERE id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- usuário real da própria construtora DEMO (criado_por realista); prefere papel de empresa (sem system_role)
  SELECT uc.user_id INTO v_user
    FROM public.user_companies uc JOIN public.users u ON u.id = uc.user_id
   WHERE uc.company_id = p_company_id AND coalesce(u.system_role, '') = ''
   ORDER BY u.email LIMIT 1;
  IF v_user IS NULL THEN
    SELECT user_id INTO v_user FROM public.user_companies WHERE company_id = p_company_id LIMIT 1;
  END IF;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario_demo');
  END IF;

  -- idempotente: limpa as simulações anteriores da DEMO antes de re-semear (empresa DEMO, sem dado de cliente)
  DELETE FROM public.erp_hub_simulacao WHERE company_id = p_company_id;

  -- impersona o usuário da DEMO para executar o FLUXO REAL (fn_simulador_salvar exige auth.uid()
  -- e guarda de empresa; o resultado salvo é recalculado no servidor, não é fixo)
  v_claim_old := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  FOR rec IN
    SELECT * FROM (VALUES
      ('Piso epóxi autonivelante 2 mm',   450::numeric, 'Galpão logístico — piso epóxi 450 m²'),
      ('Piso de uretano cimentício 6 mm', 320::numeric, 'Cozinha industrial — uretano 320 m²'),
      ('Pintura acrílica 2 demãos',       600::numeric, 'Fachada administrativa — pintura 600 m²')
    ) AS t(servico_nome, area, nome)
  LOOP
    SELECT id INTO v_sid FROM public.projetos_servicos
     WHERE company_id = p_company_id AND nome = rec.servico_nome AND coalesce(ativo, true) = true
     ORDER BY codigo LIMIT 1;
    IF v_sid IS NOT NULL THEN
      PERFORM public.fn_simulador_salvar(p_company_id, v_sid, NULL, rec.area, rec.nome, NULL);
      v_n := v_n + 1;
    END IF;
  END LOOP;

  -- restaura o claim anterior (não vaza a impersonação para o resto da transação do reset)
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_claim_old, ''), true);

  RETURN jsonb_build_object('ok', true, 'simulacoes', v_n);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_simulacoes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_simulacoes(uuid) TO service_role;

-- 2) fn_demo_reset: acrescenta o seed de simulações para a construtora DEMO (006) -------------
--    (reprodução fiel da definição viva + 1 bloco novo para a 006; nenhuma outra linha alterada)
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb;
  v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb; v_fis jsonb; v_dre jsonb;
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
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000005'::uuid THEN 'fn_gold_sst_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000006'::uuid THEN 'fn_demo_seed_construtora'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_fin := fn_demo_seed_ge_financeiro(p_company_id);
    v_ban := fn_demo_seed_ge_bancos(p_company_id);
    v_fis := fn_demo_seed_ge_fiscal(p_company_id);
    v_dre := fn_demo_seed_ge_dre(p_company_id);  -- [GE G0-F] Bloco 6: assinatura R$0 + DRE 6 meses
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre);
  END IF;

  -- 02/10: Pauta da P&M com cenário realista (atrasados, vence hoje, aguardando, rodadas)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta', public.fn_demo_seed_pm_pauta(p_company_id));
  END IF;

  -- 02/10 (PM-B): visões salvas da Pauta (link ?visao=)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_visoes', public.fn_demo_seed_pm_visoes(p_company_id));
  END IF;

  -- 02/10 (PM-C): rodadas, aprovações com prazo e motivos de espera da Pauta
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_fluxo', public.fn_demo_seed_pm_fluxo(p_company_id));
  END IF;

  -- 03/10 (Social): planejamento do mês de 2 clientes, posts e os jobs dos aprovados
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('social', public.fn_demo_seed_pm_social(p_company_id));
  END IF;

  -- 02/10 (PM-D): Meu dia — menções com @, anotações e horas de hoje
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_dia', public.fn_demo_seed_pm_dia(p_company_id));
  END IF;

  -- 31/10 (dev7claudeps · PDCA margem-job): serviço/valor/custo nos jobs + fees, para Margem por Serviço e por Fee
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('margem', public.fn_demo_seed_pm_margem(p_company_id));
  END IF;

  -- 01/11 (PDCA Hub · simulador): simulações salvas reais da construtora DEMO (bloco "Simulações salvas" não fica vazio)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- Espelha a ACL viva de fn_demo_reset (só service_role; anon/authenticated/PUBLIC já sem EXECUTE) para o gate check_fn_guards.
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO service_role;

-- 3) Irriga a construtora DEMO agora (idempotente), para o auditor reauditar logo após o deploy-migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora_simulacoes('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
