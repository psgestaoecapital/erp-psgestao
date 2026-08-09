-- =============================================================
-- FEAT-PM-P0-UNIDADE-TIMER-EQUIPE-v1 · P&M P0 (decisao A · CEO 12/06)
-- =============================================================
-- Reaproveita schema agency_* (clientes/jobs/timesheet) e fecha 3 gaps:
--
-- GAP 1 · agency_clientes.unidade (text · sem CHECK rigido)
--   Valores de UI: 'assessoria_360' | 'social_media' | 'audiovisual'
--                  | 'tecnologia'. UI valida (evita travar evolucao).
--
-- GAP 2 · agency_timesheet.inicio_em + .fim_em (cronometro ao vivo)
--   Regra: 1 timer rodando por colaborador (fim_em IS NULL = em
--   andamento) · ux_agency_timesheet_timer_ativo garante.
--   Ao parar: horas = (fim_em - inicio_em) · custo_total = horas * custo_hora.
--
-- GAP 3 · agency_equipe (master de colaborador)
--   custo_hora + jornada_horas_dia -> capacidade e rentabilidade.
--   setor: estrategico/social/criativo/performance/tecnologia.
--   UNIQUE (company_id, user_id) · RLS habilitado (policy proxima onda).
--
-- Migration aplicada via MCP em 2026-06-12.
-- =============================================================

-- GAP 1 · UNIDADE de negocio no cliente
ALTER TABLE public.agency_clientes
  ADD COLUMN IF NOT EXISTS unidade text;

-- GAP 2 · CRONOMETRO ao vivo no job
ALTER TABLE public.agency_timesheet
  ADD COLUMN IF NOT EXISTS inicio_em timestamptz,
  ADD COLUMN IF NOT EXISTS fim_em    timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ux_agency_timesheet_timer_ativo
  ON public.agency_timesheet (user_id)
  WHERE fim_em IS NULL;

-- GAP 3 · MASTER de EQUIPE
CREATE TABLE IF NOT EXISTS public.agency_equipe (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id),
  user_id           uuid REFERENCES public.users(id),
  nome              text NOT NULL,
  cargo             text,
  setor             text,
  custo_hora        numeric DEFAULT 0,
  jornada_horas_dia numeric DEFAULT 8,
  ativo             boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (company_id, user_id)
);

ALTER TABLE public.agency_equipe ENABLE ROW LEVEL SECURITY;
