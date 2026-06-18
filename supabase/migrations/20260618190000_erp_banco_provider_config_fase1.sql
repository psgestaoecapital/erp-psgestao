-- banco-multi-fase1 · fundacao multi-banco multi-tenant
-- Espelha o padrao fiscal: tabela de credencial por (empresa, banco, ambiente)
-- + duas RPCs (salvar / obter) com secrets no Vault.

CREATE TABLE IF NOT EXISTS public.erp_banco_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  banco_codigo text NOT NULL,
  provider text NOT NULL,
  ambiente text NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao','producao')),
  ativo boolean NOT NULL DEFAULT false,
  client_id text,
  client_secret_vault_id uuid,
  cert_vault_id uuid,
  cert_senha_vault_id uuid,
  agencia text,
  conta text,
  cooperativa text,
  codigo_beneficiario text,
  convenio text,
  carteira text,
  cap_extrato boolean NOT NULL DEFAULT false,
  cap_boleto boolean NOT NULL DEFAULT false,
  cap_pagamento boolean NOT NULL DEFAULT false,
  cursor_extrato text,
  ultimo_sync_em timestamptz,
  ultimo_sync_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (company_id, banco_codigo, ambiente)
);

CREATE INDEX IF NOT EXISTS ix_banco_provider_company
  ON public.erp_banco_provider_config (company_id);
CREATE INDEX IF NOT EXISTS ix_banco_provider_ativo
  ON public.erp_banco_provider_config (company_id, ativo) WHERE ativo;

ALTER TABLE public.erp_banco_provider_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_banco_provider_sel ON public.erp_banco_provider_config;
CREATE POLICY p_banco_provider_sel ON public.erp_banco_provider_config
  FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

DROP POLICY IF EXISTS p_banco_provider_adm ON public.erp_banco_provider_config;
CREATE POLICY p_banco_provider_adm ON public.erp_banco_provider_config
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.erp_banco_provider_config TO authenticated;
GRANT ALL    ON public.erp_banco_provider_config TO service_role;

COMMENT ON TABLE public.erp_banco_provider_config IS
'banco-multi-fase1 · credencial bancaria por (company, banco, ambiente). Secrets sempre no Vault; apenas os uuids ficam aqui.';
