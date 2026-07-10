-- Ingestão DIÁRIA do ponto (IO Point /point/getFromPeriod). A fonte atual
-- (ind_ponto_horas) é por período; estas tabelas trazem granularidade por DIA
-- (destrava filtro de data, heatmap-por-dia, NR-36). LGPD: sem nome/email/geo —
-- só CPF p/ dedup + campos de setor p/ agregado. RLS company-scoped.

CREATE TABLE IF NOT EXISTS public.ind_ponto_dia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid,
  cpf text NOT NULL,
  registration_number text,
  data date NOT NULL,
  shift text,
  worked_seconds integer NOT NULL DEFAULT 0,
  department text,
  team text,
  business_unit text,
  total_pontos integer NOT NULL DEFAULT 0,
  tem_ajuste boolean NOT NULL DEFAULT false,
  raw jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ind_ponto_dia_uq UNIQUE (company_id, cpf, data)
);
CREATE INDEX IF NOT EXISTS ind_ponto_dia_comp_data ON public.ind_ponto_dia (company_id, data);
CREATE INDEX IF NOT EXISTS ind_ponto_dia_dept ON public.ind_ponto_dia (company_id, department);

CREATE TABLE IF NOT EXISTS public.ind_ponto_marcacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid,
  cpf text NOT NULL,
  data date NOT NULL,
  point_id bigint,
  datetime timestamptz,
  hora time,
  method text,
  origin text,
  is_adjusted boolean NOT NULL DEFAULT false,
  adjustment_reason text,
  adjusted_by text,
  has_audit_photo boolean NOT NULL DEFAULT false,
  raw jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ind_ponto_marcacao_pt_uq UNIQUE (company_id, point_id)
);
CREATE INDEX IF NOT EXISTS ind_ponto_marcacao_comp_data ON public.ind_ponto_marcacao (company_id, data);

ALTER TABLE public.ind_ponto_dia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ind_ponto_marcacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ind_ponto_dia_pol ON public.ind_ponto_dia;
CREATE POLICY ind_ponto_dia_pol ON public.ind_ponto_dia
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS ind_ponto_marcacao_pol ON public.ind_ponto_marcacao;
CREATE POLICY ind_ponto_marcacao_pol ON public.ind_ponto_marcacao
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));

GRANT SELECT ON public.ind_ponto_dia, public.ind_ponto_marcacao TO authenticated;
