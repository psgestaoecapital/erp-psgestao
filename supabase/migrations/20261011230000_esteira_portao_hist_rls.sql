-- Portão vermelho (seguranca-search-path-prb · fn_seguranca_rls_auditar): erp_esteira_portao_hist foi criada em
-- produção fora do repo, sem RLS e com GRANT total ao anon/authenticated. Tabela interna da esteira: só service_role.
-- Idempotente e tolerante: se a tabela não existir (banco de testes), não faz nada.
DO $$
BEGIN
  IF to_regclass('public.erp_esteira_portao_hist') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.erp_esteira_portao_hist ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.erp_esteira_portao_hist FROM anon, authenticated, PUBLIC';
    EXECUTE 'GRANT ALL ON public.erp_esteira_portao_hist TO service_role';
  END IF;
END $$;
