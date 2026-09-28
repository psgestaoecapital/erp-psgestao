-- HOTFIX (achado 28/09 tarde): o sync agendado do Omie parou em 28/09 01:00 UTC — 4 empresas (M.m Serviços, Tryo
-- Acabamentos, Tryo Gesso, R.R Serviços), 15 falhas seguidas cada, "HTTP 401 · Não autenticado".
-- Causa: /api/omie/sync passou a exigir login (endurecimento das rotas /api), e fn_sync_empresa /
-- fn_sync_produtos_empresa chamam a rota pelo pg_net SEM Authorization — e ainda mandavam app_key/app_secret no corpo.
-- Correção (mesmo padrão já em produção de fn_ponto_sync_dispatch → /api/cron/ponto-diario):
--   • o pg_net manda Authorization: Bearer <service key do Vault SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER>;
--   • a rota aceita essa chamada de máquina ({ servico: true }) e lê as chaves do Omie do Vault (PR E);
--   • o corpo NÃO leva mais app_key/app_secret (segredo fora da fila do pg_net e do log).
DO $$
DECLARE f text; v_def text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fn_sync_empresa', 'fn_sync_produtos_empresa'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f;
    IF v_def IS NULL THEN RAISE EXCEPTION 'hotfix omie: função % não encontrada', f; END IF;
    IF v_def ~ 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER' THEN CONTINUE; END IF;   -- idempotente
    v_def := replace(v_def,
      $a$headers := jsonb_build_object('Content-Type', 'application/json')$a$,
      $b$headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER'))$b$);
    v_def := regexp_replace(v_def, '''app_key'',\s*v_app_key,\s*''app_secret'',\s*v_app_secret,\s*', '', 'g');
    IF v_def !~ 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER' THEN RAISE EXCEPTION 'hotfix omie: âncora do header não achada em %', f; END IF;
    IF v_def ~ '''app_secret'',\s*v_app_secret' THEN RAISE EXCEPTION 'hotfix omie: segredo ainda no corpo em %', f; END IF;
    EXECUTE v_def;
  END LOOP;
END $$;

-- guarda final
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname IN ('fn_sync_empresa','fn_sync_produtos_empresa')
               AND (p.prosrc !~ 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER' OR p.prosrc ~ '''app_secret'',\s*v_app_secret')) THEN
    RAISE EXCEPTION 'hotfix omie: sync do Omie ainda sem autorização ou com segredo no corpo';
  END IF;
END $$;
