-- Camada canonica multi-provider de ponto eletronico (industrial).
-- Cada planta/empresa pode usar um provider distinto (IO Point hoje;
-- Henry, Control iD, Secullum no futuro). Adapter por provider converte
-- o formato proprio -> modelo canonico.
--
-- LGPD (Pilar 1): dado de ponto e sensivel. RLS multi-tenant ativa em
-- todas as tabelas. Token NUNCA fica nessas tabelas — so o NOME do secret
-- no Vault em ind_ponto_provider_config.vault_secret_name.
--
-- Aplicada via MCP em 2026-06-30.

CREATE TABLE IF NOT EXISTS public.ind_ponto_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid REFERENCES public.industrial_plants(id) ON DELETE SET NULL,
  provider text NOT NULL,
  base_url text NOT NULL,
  auth_tipo text NOT NULL,
  vault_secret_name text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, provider)
);

CREATE TABLE IF NOT EXISTS public.ind_ponto_colaborador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid REFERENCES public.industrial_plants(id) ON DELETE SET NULL,
  provider text NOT NULL,
  cpf text NOT NULL,
  matricula text,
  nome text NOT NULL,
  email text,
  funcao text,
  departamento text,
  equipe text,
  unidade_negocio text,
  admissao date,
  pis text,
  raw jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider, cpf)
);
CREATE INDEX IF NOT EXISTS idx_ind_ponto_colab_company_plant
  ON public.ind_ponto_colaborador (company_id, plant_id);

CREATE TABLE IF NOT EXISTS public.ind_ponto_horas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid REFERENCES public.industrial_plants(id) ON DELETE SET NULL,
  provider text NOT NULL,
  cpf text NOT NULL,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  total_horas numeric(10,2) NOT NULL DEFAULT 0,
  funcao text,
  departamento text,
  equipe text,
  unidade_negocio text,
  raw jsonb,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider, cpf, periodo_inicio, periodo_fim)
);
CREATE INDEX IF NOT EXISTS idx_ind_ponto_horas_company_plant_periodo
  ON public.ind_ponto_horas (company_id, plant_id, periodo_inicio, periodo_fim);

ALTER TABLE public.ind_ponto_provider_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ind_ponto_colaborador     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ind_ponto_horas           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ind_ponto_provider_config_select_company ON public.ind_ponto_provider_config;
CREATE POLICY ind_ponto_provider_config_select_company ON public.ind_ponto_provider_config
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));

DROP POLICY IF EXISTS ind_ponto_colaborador_select_company ON public.ind_ponto_colaborador;
CREATE POLICY ind_ponto_colaborador_select_company ON public.ind_ponto_colaborador
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));

DROP POLICY IF EXISTS ind_ponto_horas_select_company ON public.ind_ponto_horas;
CREATE POLICY ind_ponto_horas_select_company ON public.ind_ponto_horas
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));

CREATE OR REPLACE FUNCTION public.tg_ind_ponto_provider_config_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS tg_ind_ponto_provider_config_updated_at ON public.ind_ponto_provider_config;
CREATE TRIGGER tg_ind_ponto_provider_config_updated_at
  BEFORE UPDATE ON public.ind_ponto_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_ind_ponto_provider_config_updated_at();

INSERT INTO public.ind_ponto_provider_config
  (company_id, plant_id, provider, base_url, auth_tipo, vault_secret_name, ativo)
VALUES
  ('975365cc-9e5a-4251-9022-68c6bfde10d8',
   '802fcfcd-386b-459b-9ad7-a1bf08c9c6b4',
   'iopoint',
   'https://api.iopoint.com.br/api/customer/v2',
   'header_apiIopointToken',
   'IOPOINT_TOKEN_FRIOESTE',
   true)
ON CONFLICT (company_id, plant_id, provider) DO UPDATE
  SET base_url = EXCLUDED.base_url,
      auth_tipo = EXCLUDED.auth_tipo,
      vault_secret_name = EXCLUDED.vault_secret_name,
      ativo = true;
