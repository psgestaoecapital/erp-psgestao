-- PDCA P&M (/dashboard/pm) — KPI "Clientes ativos" refletir a agência real.
-- Code: desenvolvedor_4_g
--
-- PROBLEMA (RD-38, provado no dado em 2026-11-06, DEMO company b0700000-0000-4000-a000-000000000002):
--   agency_clientes da DEMO tinha 1400 clientes status='ativo', dos quais 1392 são
--   artefatos de rodada E2E (nomes "E2E ...", "[BOT] ...", "teste", "screenshot").
--   1391 deles NÃO têm nenhum job/contrato ativo (os jobs foram soft-deletados, mas os
--   CLIENTES ficaram ativos). A agência real da DEMO tem 8 clientes. 1 cliente de teste
--   ainda tem vínculo ativo (job/contrato) e por isso é PRESERVADO.
--
-- CORREÇÃO (aditiva + idempotente, escopo TRAVADO na DEMO):
--   1) backup dos registros antes de tocar (agency_clientes_bkp_pm_pdca);
--   2) inativa (soft-delete) só os 1391 clientes de teste SEM vínculo ativo;
--   3) KPI fn_pm_bi_kpis passa a respeitar o soft-delete (excluido_em IS NULL) ao contar
--      "clientes_ativos" — endurece contra qualquer cliente inativado que ficasse contado.
--
-- SEGURANÇA: só company_id = DEMO P&M; NUNCA toca cliente real, nem cliente com job/contrato
--   ativo; é dado de DEMO (não é dado de cliente de produção/LGPD). Nenhum DELETE físico.
--
-- PROVA ESPERADA (no corpo da PR): clientes_ativos 1400 -> 9 (8 reais + 1 teste com vínculo);
--   0 clientes E2E/[BOT]/teste/screenshot ativos sem vínculo; 8 reais intactos.

-- 1) Backup dos registros que serão inativados (cria tabela só uma vez)
CREATE TABLE IF NOT EXISTS public.agency_clientes_bkp_pm_pdca (
  id uuid,
  company_id uuid,
  nome text,
  status text,
  excluido_em timestamptz,
  backup_em timestamptz NOT NULL DEFAULT now()
);

-- RLS na tabela de backup (convenção da casa: todo _bkp_* tem RLS ligada e sem acesso anon).
-- Sem policy: só definer/service_role acessa; nenhum authenticated precisa ler o backup.
-- Evita o alerta rls_disabled_in_public do security advisor (que pode travar o @pos/portão).
ALTER TABLE public.agency_clientes_bkp_pm_pdca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_clientes_bkp_pm_pdca FROM PUBLIC, anon;

INSERT INTO public.agency_clientes_bkp_pm_pdca (id, company_id, nome, status, excluido_em)
SELECT cl.id, cl.company_id, cl.nome, cl.status, cl.excluido_em
FROM public.agency_clientes cl
WHERE cl.company_id = 'b0700000-0000-4000-a000-000000000002'
  AND cl.excluido_em IS NULL
  AND COALESCE(cl.status, 'ativo') = 'ativo'
  AND (cl.nome ILIKE 'E2E%' OR cl.nome ILIKE '%[BOT]%' OR cl.nome ILIKE '%teste%' OR cl.nome ILIKE '%screenshot%')
  AND NOT EXISTS (
    SELECT 1 FROM public.agency_jobs j
    WHERE j.cliente_id = cl.id
      AND j.company_id = 'b0700000-0000-4000-a000-000000000002'
      AND j.excluido_em IS NULL
      AND COALESCE(j.status, '') NOT IN
        ('concluido','concluida','entregue','entregues','publicado','publicada','cancelado','cancelada','arquivado','arquivada')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.agency_contratos c
    WHERE c.cliente_id = cl.id
      AND c.company_id = 'b0700000-0000-4000-a000-000000000002'
      AND c.status = 'ativo'
  );

-- 2) Inativa (soft-delete) os mesmos registros — WHERE idêntico garante idempotência
UPDATE public.agency_clientes cl
SET status = 'inativo',
    excluido_em = now(),
    updated_at = now()
WHERE cl.company_id = 'b0700000-0000-4000-a000-000000000002'
  AND cl.excluido_em IS NULL
  AND COALESCE(cl.status, 'ativo') = 'ativo'
  AND (cl.nome ILIKE 'E2E%' OR cl.nome ILIKE '%[BOT]%' OR cl.nome ILIKE '%teste%' OR cl.nome ILIKE '%screenshot%')
  AND NOT EXISTS (
    SELECT 1 FROM public.agency_jobs j
    WHERE j.cliente_id = cl.id
      AND j.company_id = 'b0700000-0000-4000-a000-000000000002'
      AND j.excluido_em IS NULL
      AND COALESCE(j.status, '') NOT IN
        ('concluido','concluida','entregue','entregues','publicado','publicada','cancelado','cancelada','arquivado','arquivada')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.agency_contratos c
    WHERE c.cliente_id = cl.id
      AND c.company_id = 'b0700000-0000-4000-a000-000000000002'
      AND c.status = 'ativo'
  );

-- 3) KPI respeita o soft-delete ao contar "clientes_ativos" (única mudança vs. versão viva)
CREATE OR REPLACE FUNCTION public.fn_pm_bi_kpis(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb; v_mrr numeric; v_cli int; v_jobs int; v_horas numeric; v_com numeric; v_venc numeric;
BEGIN
  IF NOT is_admin() THEN
    p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT get_user_company_ids());
  END IF;
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('empty_state', true); END IF;
  -- MRR = fee recorrente da agência (agency_contratos), fonte única alinhada ao
  -- fn_pm_bi_series e às telas /contratos (Fees) e /comercial (consolidação #3729).
  SELECT COALESCE(sum(fee_mensal),0) INTO v_mrr FROM agency_contratos
    WHERE company_id = ANY(p_company_ids) AND status='ativo';
  -- clientes_ativos: só ativos NÃO soft-deletados (excluido_em IS NULL) — alinhado à listagem.
  SELECT count(*) INTO v_cli FROM agency_clientes
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'ativo')='ativo'
      AND excluido_em IS NULL;
  SELECT count(*) INTO v_jobs FROM agency_jobs
    WHERE company_id = ANY(p_company_ids)
      AND COALESCE(status,'') NOT IN
        ('concluido','concluida','entregue','entregues','publicado','publicada','cancelado','cancelada','arquivado','arquivada')
      AND excluido_em IS NULL;
  SELECT COALESCE(sum(horas),0) INTO v_horas FROM agency_timesheet
    WHERE company_id = ANY(p_company_ids) AND data >= date_trunc('month', current_date)::date;
  SELECT COALESCE(sum(valor_comissao),0) INTO v_com FROM agency_comissao
    WHERE company_id = ANY(p_company_ids) AND status IN ('prevista','a_pagar');
  SELECT COALESCE(sum(valor - COALESCE(valor_pago,0)),0) INTO v_venc FROM erp_receber
    WHERE company_id = ANY(p_company_ids) AND COALESCE(status,'') <> 'pago'
      AND data_vencimento < current_date AND deleted_at IS NULL;
  v := jsonb_build_object('empty_state', false,
    'mrr', v_mrr, 'clientes_ativos', v_cli, 'jobs_andamento', v_jobs,
    'horas_mes', v_horas, 'comissao_pagar', v_com, 'receber_vencido', v_venc);
  RETURN v;
END $function$;

-- 4) Guarda de ACL explícita no arquivo (espelha a ACL viva, exigida pelo gate
--    check_fn_guards Regra 1: função SECURITY DEFINER recriada precisa do REVOKE anon).
REVOKE ALL ON FUNCTION public.fn_pm_bi_kpis(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bi_kpis(uuid[]) TO authenticated, service_role;
