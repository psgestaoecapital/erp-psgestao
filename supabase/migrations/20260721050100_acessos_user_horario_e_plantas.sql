-- Acessos Fase 1: tabelas NOVAS user_horario_acesso + user_plantas. SÓ ARMAZENAM (nenhum check no login — Fase 2).
-- RLS company_id IN get_user_company_ids(). user_plantas alinhada ao user_can_access_plant (FK industrial_plants).

CREATE TABLE IF NOT EXISTS public.user_horario_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  dias_semana int[] NOT NULL DEFAULT '{}',   -- 1=Seg .. 7=Dom
  hora_inicio time NULL,
  hora_fim time NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_horario_user_company UNIQUE (user_id, company_id)
);
ALTER TABLE public.user_horario_acesso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_horario_acesso_rls ON public.user_horario_acesso;
CREATE POLICY user_horario_acesso_rls ON public.user_horario_acesso FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE TABLE IF NOT EXISTS public.user_plantas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plant_id uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_plantas UNIQUE (user_id, plant_id)
);
CREATE INDEX IF NOT EXISTS ix_user_plantas_user ON public.user_plantas (user_id);
ALTER TABLE public.user_plantas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_plantas_rls ON public.user_plantas;
CREATE POLICY user_plantas_rls ON public.user_plantas FOR ALL TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
