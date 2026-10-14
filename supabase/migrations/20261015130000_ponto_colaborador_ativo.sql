-- CH-116 (Frioeste): a lista de colaboradores espelhada do ponto nunca inativava quem saiu da empresa.
-- ADITIVA: coluna nova com default true (leitores antigos, inclusive as funcoes NR-36, seguem iguais).
ALTER TABLE public.ind_ponto_colaborador
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS desativado_em timestamptz;
COMMENT ON COLUMN public.ind_ponto_colaborador.ativo IS 'false = o provider de ponto nao devolve mais este colaborador (saiu da empresa); reativa sozinho se voltar.';
CREATE INDEX IF NOT EXISTS ix_ind_ponto_colaborador_empresa_ativo ON public.ind_ponto_colaborador (company_id, ativo);
