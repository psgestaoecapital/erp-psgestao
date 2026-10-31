-- DEV7CLAUDEPS · PDCA P&M · /dashboard/pm/margem-job (auditor_pdca_2) — dimensões Serviço e Fee demonstráveis na DEMO.
--
-- PROVA NO DADO (RD-38, produção, BEGIN…ROLLBACK, statement_timeout curto):
--   empresa DEMO P&M = b0700000-0000-4000-a000-000000000002 (is_demo).
--   agency_jobs: 8147 no total, mas só 60 ATIVOS (8087 soft-deleted em excluido_em); dos ativos TODOS tinham
--   valor_job = 0/NULL, servico_id em branco e agency_contratos (fee) = 0 → a tela jogava tudo em "Sem serviço" e
--   "Fora de fee (avulso)", sem margem.
--
-- ESTA MIGRATION (ADITIVA, SÓ DEMO is_demo — não toca cliente real nem financeiro de cliente):
--   fn_demo_seed_pm_margem(company) irriga os jobs ATIVOS da DEMO com serviço + valor + custo estimado
--   determinísticos (hashtext do id, sem random → idempotente) e cria 4 fees (agency_contratos) ligando os jobs
--   dos clientes de fee. A tela (page.tsx) passa a ocultar jobs soft-deleted (respeita a exclusão rastreável, RD-98).
--   A tela NÃO é reescrita (o auditor já a considera "tela boa"). Mesma raiz de /pm/contratos.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_margem(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: fn_demo_seed_pm_margem — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_jobs int := 0; v_fees int := 0; v_lig int := 0; r record;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;

  -- (A) serviço + valor + custo estimado nos jobs ativos sem valor (janela da tela: 1000 mais recentes).
  --     catálogo humano (sem [BOT]); valor = base ±20%; custo = 35–70% do valor → margem variada p/ o semáforo.
  WITH svc AS (
    SELECT row_number() OVER (ORDER BY m.nome) - 1 AS idx, s.id, m.base
    FROM (VALUES ('Post feed',180),('Carrossel',350),('Stories',120),('Reels',900),
                 ('Banner para site',250),('Folder',400),('Landing page',1500),('Vídeo institucional',2500)) m(nome,base)
    JOIN agency_servico s ON s.company_id = v_demo AND s.nome = m.nome
  ), n AS (SELECT count(*) c FROM svc),
  alvo AS (
    SELECT j.id, abs(hashtext(j.id::text)) h
    FROM agency_jobs j
    WHERE j.company_id = v_demo AND j.excluido_em IS NULL AND coalesce(j.valor_job, 0) = 0
    ORDER BY j.created_at DESC NULLS LAST
    LIMIT 1000
  ),
  pick AS (SELECT a.id, a.h, s.id svc_id, s.base FROM alvo a CROSS JOIN n JOIN svc s ON s.idx = (a.h % n.c))
  UPDATE agency_jobs j
     SET servico_id     = COALESCE(j.servico_id, p.svc_id),
         valor_job      = round((p.base * (0.80 + (p.h % 41)/100.0))::numeric, 2),
         custo_estimado = round((p.base * (0.80 + (p.h % 41)/100.0) * (0.35 + ((p.h/7) % 36)/100.0))::numeric, 2)
    FROM pick p WHERE j.id = p.id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  -- (B) fees (agency_contratos) para 4 clientes com job, por NOME (estável entre resets). Idempotente por observacoes.
  FOR r IN
    SELECT cl.id cli, v.fee
    FROM (VALUES ('Pet Amigo',2500),('Café Serra Azul',3200),('Clínica Sorriso Vale',3500),('Academia Pulso',1800)) v(nome, fee)
    JOIN agency_clientes cl ON cl.company_id = v_demo AND cl.nome = v.nome
  LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_contratos WHERE company_id = v_demo AND cliente_id = r.cli AND observacoes = 'demo-margem') THEN
      INSERT INTO agency_contratos (company_id, cliente_id, tipo, fee_mensal, dia_vencimento, data_inicio, status, documentacao_ok, observacoes)
      VALUES (v_demo, r.cli, 'recorrente', r.fee, 10,
              (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 months')::date,
              'ativo', true, 'demo-margem');
      v_fees := v_fees + 1;
    END IF;
  END LOOP;

  -- (C) liga os jobs ativos (já irrigados) dos clientes de fee ao respectivo fee; os demais ficam "avulso".
  WITH fee AS (SELECT cliente_id, id FROM agency_contratos WHERE company_id = v_demo AND observacoes = 'demo-margem')
  UPDATE agency_jobs j
     SET fee_id = f.id, contrato_id = COALESCE(j.contrato_id, f.id)
    FROM fee f
   WHERE j.company_id = v_demo AND j.excluido_em IS NULL AND j.fee_id IS NULL
     AND j.cliente_id = f.cliente_id AND coalesce(j.valor_job, 0) > 0;
  GET DIAGNOSTICS v_lig = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'jobs_irrigados', v_jobs, 'fees', v_fees, 'jobs_ligados_fee', v_lig);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_demo_seed_pm_margem(uuid) FROM PUBLIC, anon, authenticated;

-- Wire no orquestrador: a cada fn_demo_reset da DEMO P&M, irriga a margem por job depois dos demais seeds de P&M.
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

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- Espelha a ACL viva de fn_demo_reset (só service_role; anon/authenticated/PUBLIC já sem EXECUTE) para o gate check_fn_guards.
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO service_role;

-- Irriga a DEMO P&M agora (idempotente), para o auditor reauditar logo após o deploy-migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000002' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_pm_margem('b0700000-0000-4000-a000-000000000002');
  END IF;
END $$;
