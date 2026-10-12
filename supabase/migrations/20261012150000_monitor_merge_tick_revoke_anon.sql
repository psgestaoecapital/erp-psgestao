-- Corrige o check_fn_guards vermelho na main (#2433): fn_monitor_merge_tick é SECURITY DEFINER e ficou sem REVOKE de anon.
-- Só o relógio (pg_cron/postgres) e a conexão de serviço chamam; nenhum papel de cliente precisa.
REVOKE ALL ON FUNCTION public.fn_monitor_merge_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_monitor_merge_tick() TO service_role;
