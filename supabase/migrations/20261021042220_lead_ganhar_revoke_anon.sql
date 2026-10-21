-- #2263 · fn_agency_lead_ganhar é SECURITY DEFINER: reafirma o REVOKE anon (check_fn_guards).
-- Produção já está assim (proacl: postgres, authenticated, service_role); não abre nada novo.
REVOKE ALL ON FUNCTION public.fn_agency_lead_ganhar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_lead_ganhar(uuid) TO authenticated, service_role;
