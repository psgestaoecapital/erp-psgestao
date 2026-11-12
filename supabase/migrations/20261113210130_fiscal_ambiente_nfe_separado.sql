-- #5666 · Ambiente (homologação/produção) separado para NF-e. Aditivo: NULL = segue `ambiente` da empresa.
-- Backfill = ambiente atual, então NADA muda no comportamento de nenhuma empresa ao publicar.
-- Não toca numeração, séries nem tokens.
ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS ambiente_nfe text;
DO $$ BEGIN
  ALTER TABLE public.erp_fiscal_provider_config
    ADD CONSTRAINT erp_fiscal_provider_config_ambiente_nfe_chk CHECK (ambiente_nfe IS NULL OR ambiente_nfe IN ('homologacao','producao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE public.erp_fiscal_provider_config SET ambiente_nfe = ambiente
 WHERE ambiente_nfe IS NULL AND ambiente IN ('homologacao','producao');
COMMENT ON COLUMN public.erp_fiscal_provider_config.ambiente_nfe IS
 '#5666 ambiente só da NF-e (modelo 55). NULL = segue ambiente. NFS-e/NFC-e seguem ambiente.';
