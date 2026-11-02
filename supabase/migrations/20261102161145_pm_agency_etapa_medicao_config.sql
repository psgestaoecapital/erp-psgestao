-- CEO 02/11 · Blueprint P&M §3 — "Medição de tempo configurável por etapa e por cliente" · PR1: camada de dados.
-- Tabela nova e ADITIVA: define, por empresa e (opcional) por cliente, se um tipo de etapa do timesheet
-- CONTA como custo direto ("medir"). Resolução (consumida nas próximas PRs): cliente > agência
-- (cliente_id NULL) > sistema (quando não há linha, o padrão é medir=true).
-- Esta PR NÃO tem UI e NÃO altera o cálculo de custo (PR2 = tela de configuração; PR3 = custo direto
-- passa a considerar só as etapas medidas, com antes/depois na DEMO). `etapa_tipo` casa com
-- agency_timesheet.etapa_tipo (texto livre hoje), por isso não é enum.

CREATE TABLE IF NOT EXISTS public.agency_etapa_medicao_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  cliente_id  uuid NULL,                 -- NULL = padrão da agência; preenchido = regra específica do cliente
  etapa_tipo  text NOT NULL,             -- casa com agency_timesheet.etapa_tipo
  medir       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agency_etapa_medicao_config IS
  'P&M (Blueprint §3): por empresa e opcionalmente por cliente, se um etapa_tipo do timesheet conta como custo direto (medir). Resolução cliente > agência (cliente_id NULL) > sistema (sem linha = medir=true).';

-- Unicidade: um padrão de agência por (empresa, etapa) e uma regra por (empresa, cliente, etapa).
CREATE UNIQUE INDEX IF NOT EXISTS ux_agency_etapa_medicao_agencia
  ON public.agency_etapa_medicao_config (company_id, etapa_tipo)
  WHERE cliente_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_agency_etapa_medicao_cliente
  ON public.agency_etapa_medicao_config (company_id, cliente_id, etapa_tipo)
  WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_agency_etapa_medicao_company
  ON public.agency_etapa_medicao_config (company_id);

ALTER TABLE public.agency_etapa_medicao_config ENABLE ROW LEVEL SECURITY;

-- RLS por empresa (mesmo padrão de agency_timesheet): company_id do usuário OU admin.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.agency_etapa_medicao_config'::regclass
      AND polname = 'agency_etapa_medicao_config_access'
  ) THEN
    CREATE POLICY agency_etapa_medicao_config_access
      ON public.agency_etapa_medicao_config
      FOR ALL
      USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
      WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
  END IF;
END$$;

-- Sem acesso anônimo; leitura para usuários logados. Escrita virá por RPC guardada (PR2), não direto.
REVOKE ALL ON public.agency_etapa_medicao_config FROM anon;
GRANT SELECT ON public.agency_etapa_medicao_config TO authenticated;
