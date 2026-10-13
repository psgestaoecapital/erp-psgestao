-- #286 (CEO 28/09): a NFS-e passa a levar as retenções federais do cadastro do serviço (INSS, IR, PIS, COFINS,
-- CSLL) e o PIS/COFINS de apuração própria. O grupo piscofins da DPS exige o CST (leiaute oficial, Anexo I v1.01,
-- linha 314) — o cadastro do serviço não tinha onde guardá-lo. Coluna nova, vazia: quem preenche é o cliente/
-- contador (para a FC, pelo XML da NF 418). Nada é preenchido por esta migration.
ALTER TABLE public.erp_servicos
  ADD COLUMN IF NOT EXISTS cst_pis_cofins text;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_servicos_cst_pis_cofins_chk') THEN
    ALTER TABLE public.erp_servicos
      ADD CONSTRAINT erp_servicos_cst_pis_cofins_chk CHECK (cst_pis_cofins IS NULL OR cst_pis_cofins ~ '^[0-9]{2}$');
  END IF;
END $do$;

COMMENT ON COLUMN public.erp_servicos.cst_pis_cofins IS
  'CST do PIS/COFINS (2 dígitos) da NFS-e Nacional (tag CST do grupo piscofins). Sem ele a nota não leva PIS/COFINS de apuração própria nem retenção de PIS/COFINS/CSLL.';

-- guarda
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='erp_servicos' AND column_name='cst_pis_cofins') THEN
    RAISE EXCEPTION 'coluna cst_pis_cofins não criada';
  END IF;
END $do$;
