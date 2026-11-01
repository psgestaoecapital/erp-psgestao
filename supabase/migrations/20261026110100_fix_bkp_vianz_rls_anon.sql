-- Segurança (21/10): o auditor fn_seguranca_rls_auditar acusou `tabela_sem_rls_com_anon`
-- para bkp_vianz_preco_venda_20261021 — uma tabela de BACKUP criada sem RLS e com acesso anon
-- (as outras 10 bkp_* já têm RLS). Furo real: anon podia ler o backup. Travava o @pos-migration.
-- Hotfix aplicado em produção em 21/10; este arquivo registra e reaplica (idempotente) o fechamento.
DO $$
BEGIN
  IF to_regclass('public.bkp_vianz_preco_venda_20261021') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.bkp_vianz_preco_venda_20261021 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.bkp_vianz_preco_venda_20261021 FROM anon';
  END IF;
END $$;
