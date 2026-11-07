-- #5666 · ambiente (homologação/produção) separado para NF-e. Aditiva: coluna nula = herda `ambiente` (NFS-e), então
-- nenhuma empresa muda de ambiente ao publicar. Não toca numeração, séries nem tokens/cofre.
ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS ambiente_nfe text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_fiscal_provider_config_ambiente_nfe_chk') THEN
    ALTER TABLE public.erp_fiscal_provider_config
      ADD CONSTRAINT erp_fiscal_provider_config_ambiente_nfe_chk CHECK (ambiente_nfe IS NULL OR ambiente_nfe IN ('homologacao','producao'));
  END IF;
END $$;
COMMENT ON COLUMN public.erp_fiscal_provider_config.ambiente_nfe IS '#5666: ambiente só da NF-e; NULL = usa ambiente (NFS-e).';
