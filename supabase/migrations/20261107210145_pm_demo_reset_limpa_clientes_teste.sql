-- PDCA P&M (/dashboard/pm) — "Clientes ativos" NÃO pode voltar a inflar com artefatos de E2E.
-- Code: desenvolvedor_4_g
--
-- CONTEXTO (RD-38, reconferência auditor_pdca_2 07/11, DEMO company b0700000-0000-4000-a000-000000000002):
--   A #3982 (migration 20261107160145) fez a limpeza PONTUAL dos clientes de teste e o KPI passou a
--   respeitar o soft-delete (excluido_em IS NULL). FUNCIONOU (1400 -> 11). PORÉM a limpeza pontual
--   REGRIDE: rodadas E2E posteriores recriam clientes "E2E/[BOT]/teste/screenshot" sem job/contrato
--   ativo. Hoje a DEMO voltou a 13 ativos, dos quais 4 são ghosts de E2E sem vínculo. Alvo real: 9.
--
-- CORREÇÃO (raiz, aditiva + idempotente): a limpeza deixa de ser uma passada única e vira parte do
--   ciclo de reset da demo. Nenhuma lógica nova de critério — é exatamente o mesmo WHERE da #3982,
--   agora encapsulado numa função reutilizável que o fn_demo_reset chama no braço da P&M (002).
--   Assim, todo "montar banco de testes"/reset reaplica a limpeza e a tela não volta a inflar.
--
-- SEGURANÇA (INEGOCIÁVEL):
--   * trava dura: só age em empresa is_demo = true (a função sai com 0 se não for demo);
--   * escopo por company_id (parâmetro); NUNCA toca cliente real nem cliente com job/contrato ativo;
--   * é dado de DEMO (não é dado de cliente de produção/LGPD); nenhum DELETE físico (só soft-delete);
--   * SECURITY DEFINER com search_path fixo; REVOKE anon/authenticated; GRANT só service_role.
--
-- PROVA (RD-38, no corpo da PR, DEMO 002):
--   antes = 13 ativos; a_limpar = 4; depois = 9; clientes com job/contrato tocados = 0.

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Função reutilizável de limpeza (mesmo critério da #3982, agora chamável pelo reset)
-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_demo_pm_limpar_clientes_teste — reset da DEMO; só service_role; trava por is_demo=true + company_id, não por membership de usuário (sem auth.uid no fluxo de reset)
CREATE OR REPLACE FUNCTION public.fn_demo_pm_limpar_clientes_teste(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean;
  v_n integer := 0;
BEGIN
  IF p_company_id IS NULL THEN RETURN 0; END IF;
  SELECT c.is_demo INTO v_is_demo FROM public.companies c WHERE c.id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN RETURN 0; END IF;  -- trava dura: só DEMO

  UPDATE public.agency_clientes cl
  SET status = 'inativo',
      excluido_em = now(),
      updated_at = now()
  WHERE cl.company_id = p_company_id
    AND cl.excluido_em IS NULL
    AND COALESCE(cl.status, 'ativo') = 'ativo'
    AND (cl.nome ILIKE 'E2E%' OR cl.nome ILIKE '%[BOT]%' OR cl.nome ILIKE '%teste%' OR cl.nome ILIKE '%screenshot%')
    AND NOT EXISTS (
      SELECT 1 FROM public.agency_jobs j
      WHERE j.cliente_id = cl.id
        AND j.company_id = p_company_id
        AND j.excluido_em IS NULL
        AND COALESCE(j.status, '') NOT IN
          ('concluido','concluida','entregue','entregues','publicado','publicada','cancelado','cancelada','arquivado','arquivada')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.agency_contratos c
      WHERE c.cliente_id = cl.id
        AND c.company_id = p_company_id
        AND c.status = 'ativo'
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_pm_limpar_clientes_teste(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_pm_limpar_clientes_teste(uuid) TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- 2) fn_demo_reset: reproduz a versão viva e só ACRESCENTA a limpeza no braço da P&M (002)
--    (única mudança vs. a definição vigente: o bloco "limpeza_clientes_teste")
-- ──────────────────────────────────────────────────────────────────────────────────────────────
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

  -- 07/11 (desenvolvedor_4_g · PDCA /dashboard/pm): a cada reset, reaplica a limpeza dos clientes de
  -- teste (E2E/[BOT]/teste/screenshot SEM job/contrato ativo) para o KPI "Clientes ativos" não voltar
  -- a inflar entre rodadas de E2E. Idempotente e travado em empresa is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('limpeza_clientes_teste', public.fn_demo_pm_limpar_clientes_teste(p_company_id));
  END IF;

  -- 01/11 (PDCA Hub · simulador): simulações salvas reais da construtora DEMO (bloco "Simulações salvas" não fica vazio)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- 3) Primeira passada: limpa os ghosts que já voltaram (idempotente; re-rodar toca 0 linhas)
-- ──────────────────────────────────────────────────────────────────────────────────────────────
SELECT public.fn_demo_pm_limpar_clientes_teste('b0700000-0000-4000-a000-000000000002'::uuid);
