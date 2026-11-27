-- Dono ativo da empresa (CLIENT_OWNER) pode importar relatórios de pausa NR-36,
-- independente do teto do próprio user_scope (escopo-dados não concede teto a dono).
CREATE OR REPLACE FUNCTION public.fn_nr36_pode_subir(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
     AND (
       public.is_client_owner(p_company_id)
       OR COALESCE((public.fn_acesso_efetivo(auth.uid(), p_company_id) -> 'decidido' ->> 'tem_papel')::boolean, false) = false
       OR (public.fn_acesso_efetivo(auth.uid(), p_company_id) -> 'acessos' ->> 'docs_regulatorios') IN ('editar','aprovar')
     );
$function$;

REVOKE ALL ON FUNCTION public.fn_nr36_pode_subir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pode_subir(uuid) TO authenticated, service_role;
