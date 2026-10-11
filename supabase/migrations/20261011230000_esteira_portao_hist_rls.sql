-- Portão vermelho (seguranca-search-path-prb · fn_seguranca_rls_auditar → tabela_sem_rls_com_anon):
-- erp_esteira_portao_hist foi criada direto no banco, sem RLS e com GRANT total ao anon/authenticated.
-- Tabela interna da esteira (só a conexão de serviço escreve/lê): liga RLS (sem policy = só service_role)
-- e tira os direitos de anon e authenticated.
ALTER TABLE IF EXISTS public.erp_esteira_portao_hist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_esteira_portao_hist FROM anon, authenticated;
