-- Completa a reconciliação da 20261126153409 (aplicada via MCP fora do repositório): a função de trigger
-- fn_psgc_dre_guarda_corte nasceu SECURITY DEFINER sem REVOKE de anon. Fecha agora.
REVOKE ALL ON FUNCTION public.fn_psgc_dre_guarda_corte() FROM PUBLIC, anon;
