-- P0 SEGURANÇA (Supabase advisors 2026-07-28; alerta do André). Não-destrutivo e reversível. Nenhuma linha apagada.
--
-- 1) auth.users vazando p/ 'anon' via 3 views do BPO (lint auth_users_exposed). O painel roda como
--    'authenticated' → remover 'anon' não quebra o painel. (Prova: advisor pós-migração mostra exposed_to
--    passando de ['anon'] para ['authenticated'] — o anon saiu.)
REVOKE ALL ON public.v_bpo_admin_painel        FROM anon;
REVOKE ALL ON public.v_bpo_painel_empresa       FROM anon;
REVOKE ALL ON public.v_bpo_performance_operador FROM anon;

-- 2) backups com dado financeiro/credencial abertos (lint rls_disabled_in_public): liga RLS (sem policy =
--    nega via PostgREST) + remove grants anon/authenticated. service_role/postgres seguem p/ restore.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    '_bkp_erp_pagar_20260728',
    '_bkp_erp_receber_20260728',
    '_bkp_banco_config_kgf_20260728',
    '_bkp_user_scope_20260728'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', t);
    END IF;
  END LOOP;
END $$;

-- Reversão (se necessário):
--   GRANT ALL ON public.v_bpo_admin_painel, public.v_bpo_painel_empresa, public.v_bpo_performance_operador TO anon;
--   ALTER TABLE public._bkp_*_20260728 DISABLE ROW LEVEL SECURITY;
--   GRANT ALL ON public._bkp_*_20260728 TO anon, authenticated;
