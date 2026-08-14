-- P&M Fase 0 · Espinha dorsal (Blueprint V4.0) — 100% ADITIVO (RD-30/RD-54).
-- Elos cliente↔GE, job↔contrato/fee, contrato↔responsável + medição de tempo por etapa/cliente.
-- Só ADD COLUMN / CREATE INDEX / backfill. NADA dropado. Base para Contrato, Rentabilidade e BI.
-- Colunas conferidas no banco: agency_clientes já tem contrato_id; agency_jobs já tem responsavel_id
-- (o SPEC adiciona essas em OUTRAS tabelas, sem colisão).

-- ── 1) Elos de arquitetura (ADD COLUMN + FK) ───────────────────────────────────────────────────────
-- Cliente da agência ↔ cadastro GE (cadastrou na GE vira cliente da agência)
ALTER TABLE public.agency_clientes
  ADD COLUMN IF NOT EXISTS erp_cliente_id uuid REFERENCES public.erp_clientes(id);

-- Job pertence a um contrato/fee
ALTER TABLE public.agency_jobs
  ADD COLUMN IF NOT EXISTS contrato_id uuid REFERENCES public.agency_contratos(id),
  ADD COLUMN IF NOT EXISTS fee_id uuid;   -- reservado (fee = agency_clientes.fee_mensal por ora)

-- Contrato tem responsável (gestor da conta, distinto do comercial que vendeu)
ALTER TABLE public.agency_contratos
  ADD COLUMN IF NOT EXISTS responsavel_id uuid;

-- ── 2) Medição de tempo por etapa (habilita rentabilidade) ─────────────────────────────────────────
ALTER TABLE public.agency_timesheet
  ADD COLUMN IF NOT EXISTS etapa_tipo text,   -- lead|proposta|cadastro_cliente|contrato|briefing|planejamento|aprovacao_planejamento|job|aprovacao_job|publicacao
  ADD COLUMN IF NOT EXISTS cliente_id uuid;   -- agregação por cliente em toda etapa

CREATE INDEX IF NOT EXISTS idx_timesheet_cliente_etapa
  ON public.agency_timesheet (company_id, cliente_id, etapa_tipo);

-- ── 3) Backfill do seed [DEMO] (RD-54: só liga o que casa; exato e ÚNICO p/ evitar vínculo arbitrário)
-- Liga agency_clientes ao erp_clientes por CNPJ/CPF exato, apenas quando o par (empresa, doc) é único no GE.
UPDATE public.agency_clientes ac
SET erp_cliente_id = sub.eid
FROM (
  SELECT company_id, cnpj_cpf, (array_agg(id))[1] AS eid
  FROM public.erp_clientes
  WHERE cnpj_cpf IS NOT NULL AND btrim(cnpj_cpf) <> ''
  GROUP BY company_id, cnpj_cpf
  HAVING count(*) = 1
) sub
WHERE ac.company_id = sub.company_id
  AND ac.cnpj_cpf = sub.cnpj_cpf
  AND ac.erp_cliente_id IS NULL
  AND ac.cnpj_cpf IS NOT NULL AND btrim(ac.cnpj_cpf) <> '';

-- Liga jobs ao contrato do mesmo cliente, apenas quando o cliente tem UM único contrato.
UPDATE public.agency_jobs aj
SET contrato_id = sub.cid
FROM (
  SELECT company_id, cliente_id, (array_agg(id))[1] AS cid
  FROM public.agency_contratos
  WHERE cliente_id IS NOT NULL
  GROUP BY company_id, cliente_id
  HAVING count(*) = 1
) sub
WHERE aj.company_id = sub.company_id
  AND aj.cliente_id = sub.cliente_id
  AND aj.contrato_id IS NULL;
