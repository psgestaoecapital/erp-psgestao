-- Regulariza o check:fn-guards (revoke_anon) da 20261012133000: a função SECURITY DEFINER do monitor da esteira
-- não pode ficar executável por anon. O estado vivo já é esse (anon sem EXECUTE); a migration registra no repo.
-- Só REVOKE: nenhuma mudança de lógica, nenhum dado de cliente.
REVOKE ALL ON FUNCTION public.fn_monitor_merge_tick() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_monitor_merge_tick() TO authenticated, service_role;
