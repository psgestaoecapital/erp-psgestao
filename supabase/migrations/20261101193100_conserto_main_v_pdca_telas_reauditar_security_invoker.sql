-- conserto-main: a view v_pdca_telas_reauditar nasceu SEM security_invoker=on
-- (criada fora de migration/ledger) e corria com os direitos do dono.
-- A auditoria fn_seguranca_rls_auditar a aponta em view_com_direitos_do_dono
-- (total_achados=1, ok=false), derrubando o @pos-migration em
-- e2e/jornadas/aceitacao/seguranca-search-path-prb.spec.ts:36 e travando o portao.
--
-- Regra do briefing: "view nova nasce com security_invoker=on; achado aqui = trabalho AGORA".
-- anon NAO tem GRANT na view (so postgres/service_role), entao nao ha exposicao ativa;
-- esta correcao fecha o achado de higiene/politica sem alterar comportamento:
-- service_role ignora RLS de qualquer forma. Idempotente e defensiva (so age se a view existe).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'v_pdca_telas_reauditar'
      AND n.nspname = 'public'
      AND c.relkind = 'v'
  ) THEN
    EXECUTE 'ALTER VIEW public.v_pdca_telas_reauditar SET (security_invoker = on)';
  END IF;
END $$;
