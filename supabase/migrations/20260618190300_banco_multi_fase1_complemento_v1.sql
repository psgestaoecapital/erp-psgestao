-- banco-multi-fase1-complemento · webhook secret + log + campos boleto + orquestracao

ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS webhook_secret_vault_id uuid;

CREATE TABLE IF NOT EXISTS public.erp_banco_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  banco_codigo text,
  provider text,
  tipo text NOT NULL,
  status text NOT NULL,
  qtd integer DEFAULT 0,
  mensagem text,
  payload_resumo jsonb,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE public.erp_banco_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_banco_sync_log_sel ON public.erp_banco_sync_log;
CREATE POLICY p_banco_sync_log_sel ON public.erp_banco_sync_log
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE INDEX IF NOT EXISTS ix_banco_sync_log_company
  ON public.erp_banco_sync_log (company_id, criado_em DESC);

GRANT SELECT ON public.erp_banco_sync_log TO authenticated;
GRANT ALL    ON public.erp_banco_sync_log TO service_role;

ALTER TABLE public.erp_receber
  ADD COLUMN IF NOT EXISTS boleto_nosso_numero text,
  ADD COLUMN IF NOT EXISTS boleto_linha_digitavel text,
  ADD COLUMN IF NOT EXISTS boleto_codigo_barras text,
  ADD COLUMN IF NOT EXISTS boleto_url text,
  ADD COLUMN IF NOT EXISTS boleto_status text,
  ADD COLUMN IF NOT EXISTS boleto_id_externo text,
  ADD COLUMN IF NOT EXISTS boleto_banco_codigo text,
  ADD COLUMN IF NOT EXISTS boleto_emitido_em timestamptz,
  ADD COLUMN IF NOT EXISTS boleto_pago_em timestamptz;

CREATE INDEX IF NOT EXISTS ix_erp_receber_boleto_idext
  ON public.erp_receber (company_id, boleto_id_externo);

CREATE OR REPLACE FUNCTION public.fn_banco_provider_listar_ativos()
RETURNS TABLE(
  company_id uuid,
  banco_codigo text,
  provider text,
  ambiente text,
  cap_extrato boolean,
  cap_boleto boolean,
  cap_pagamento boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id, banco_codigo, provider, ambiente,
         cap_extrato, cap_boleto, cap_pagamento
    FROM public.erp_banco_provider_config
   WHERE ativo
$$;

REVOKE ALL ON FUNCTION public.fn_banco_provider_listar_ativos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_banco_provider_listar_ativos() TO service_role;

COMMENT ON FUNCTION public.fn_banco_provider_listar_ativos() IS
'banco-multi-fase1 · service_role only · iterador pra edge/cron das empresas+bancos ativos.';

COMMENT ON TABLE public.erp_banco_sync_log IS
'banco-multi-fase1 · log generico de sincronizacao bancaria (observabilidade).';
