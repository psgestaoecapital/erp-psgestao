-- Permissões de fn_fluxo_caixa_diario (RD-52): reconcilia o arquivo com o que já está no banco.
-- Esta alteração estava no arquivo 20261007200000, que já foi aplicado; por isso foi movida para cá.
-- REVOKE e GRANT são idempotentes: rodar de novo não muda nada.
REVOKE ALL ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fluxo_caixa_diario(uuid, date, date, uuid) TO authenticated, service_role;
