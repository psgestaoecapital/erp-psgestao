-- PDCA P&M (/dashboard/producao) — purga ONE-TIME dos clientes de teste reacumulados na DEMO.
-- Code: desenvolvedor_4_g
--
-- PROBLEMA (RD-38, provado no dado em 2026-11-17, DEMO company b0700000-0000-4000-a000-000000000002):
--   A limpeza de 2026-11-07 (migration 20261107160145) zerou os clientes de teste, mas o leak
--   voltou: o spec e2e pdois-lead-ganho chama fn_agency_lead_ganhar, que INSERE um agency_clientes
--   (nome = empresa do lead, "E2E Ganho%") e o afterAll não limpava. Entre 07/11 e 17/11
--   acumularam-se de novo ~1124 clientes "E2E Ganho%" ativos (1133 vivos totais, agência real = 8).
--   A causa-raiz foi estancada no mesmo lote (afterAll do spec agora soft-deleta o cliente do RUN).
--   Descoberta 6f3bdbc6 (auditor_pdca_1). Esta migration faz a purga one-time do que já acumulou.
--
-- CORREÇÃO (aditiva + idempotente, escopo TRAVADO na DEMO P&M):
--   1) backup dos registros antes de tocar (reusa agency_clientes_bkp_pm_pdca, com RLS/anon fechados);
--   2) inativa (soft-delete, excluido_em) só os clientes de teste SEM vínculo ativo (job/contrato).
--   Mesma lógica e mesmo WHERE da 20261107160145 — nada de novo além de alcançar o lote reacumulado.
--
-- SEGURANÇA: só company_id = DEMO P&M; NUNCA toca cliente real, nem cliente com job/contrato
--   ativo; é dado de DEMO (não é dado de cliente de produção/LGPD). Nenhum DELETE físico.
--
-- PROVA ESPERADA (no corpo da PR): vivos 1133 -> ~9 (8 reais + os de teste com vínculo ativo
--   preservados); 0 clientes E2E/[BOT]/teste/screenshot ativos sem vínculo.

-- 1) Backup dos registros que serão inativados (tabela já existe da 20261107160145).
CREATE TABLE IF NOT EXISTS public.agency_clientes_bkp_pm_pdca (
  id uuid,
  company_id uuid,
  nome text,
  status text,
  excluido_em timestamptz,
  backup_em timestamptz NOT NULL DEFAULT now()
);

-- RLS/anon fechados (convenção da casa: todo _bkp_* tem RLS ligada e sem acesso anon). Idempotente.
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
  )
  -- idempotência do backup: não duplica linha já salva
  AND NOT EXISTS (
    SELECT 1 FROM public.agency_clientes_bkp_pm_pdca b WHERE b.id = cl.id
  );

-- 2) Inativa (soft-delete) os mesmos registros — WHERE idêntico garante idempotência (re-run = no-op).
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
