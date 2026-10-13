-- Amenda #736: cadastro COMPLETO de cliente (drawer) precisa gravar o IBGE do município (obrigatório na NF).
-- O ViaCEP já retorna o código; não existia coluna sob outro nome. ie (Inscrição Estadual, p/ NF-e) já existe.
ALTER TABLE public.erp_clientes ADD COLUMN IF NOT EXISTS codigo_ibge_municipio text;
COMMENT ON COLUMN public.erp_clientes.codigo_ibge_municipio IS 'Código IBGE do município (7 dígitos) — do ViaCEP; obrigatório para emissão de NF.';
