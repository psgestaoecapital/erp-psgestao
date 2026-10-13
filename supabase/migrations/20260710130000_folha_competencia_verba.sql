-- Conector de folha (Domínio Sistemas). Schema FLEXÍVEL: cabeçalho por
-- funcionário/mês (folha_competencia) + 1 linha por verba (folha_verba) →
-- quando a folha detalhar base/HE/noturno/DSR, cada verba nova entra SEM migração.
-- LGPD: salário é dado sensível — RLS company-scoped; BI expõe só agregado por setor.

CREATE TABLE IF NOT EXISTS public.folha_competencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  matricula integer NOT NULL,
  cpf text,
  cod_esocial text,
  competencia date NOT NULL,
  nome text,
  org_unidade_id uuid,
  total_geral numeric(14,2) NOT NULL DEFAULT 0,
  remuneracao numeric(14,2) NOT NULL DEFAULT 0,
  raw jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folha_competencia_uq UNIQUE (company_id, matricula, competencia)
);
CREATE INDEX IF NOT EXISTS folha_comp_comp ON public.folha_competencia (company_id, competencia);

CREATE TABLE IF NOT EXISTS public.folha_verba (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folha_competencia_id uuid NOT NULL REFERENCES public.folha_competencia(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  matricula integer NOT NULL,
  competencia date NOT NULL,
  codigo_verba text NOT NULL,
  descricao text,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  tipo text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folha_verba_comp ON public.folha_verba (company_id, competencia);
CREATE INDEX IF NOT EXISTS folha_verba_fk ON public.folha_verba (folha_competencia_id);

ALTER TABLE public.folha_competencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folha_verba ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS folha_competencia_pol ON public.folha_competencia;
CREATE POLICY folha_competencia_pol ON public.folha_competencia
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS folha_verba_pol ON public.folha_verba;
CREATE POLICY folha_verba_pol ON public.folha_verba
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()));

GRANT SELECT ON public.folha_competencia, public.folha_verba TO authenticated;
