-- ============================================================
-- Oficina Onda 1 · designação por id — lista de mecânicos CADASTRADOS (com user id)
-- ============================================================
-- fn_oficina_mecanicos (já existe) devolve só NOMES, tirados do histórico livre das OS (grafia suja,
-- sem id) — serve pra autocomplete, não pra designar por id. Para a designação gravar mecanico_id
-- (e assim a fila do 3.3 encher por auth.uid()), a tela precisa de mecânicos com IDENTIDADE:
-- os usuários da empresa cujo papel no tenant é OFICINA_MECANICO ou OFICINA_DONO (fonte canônica de
-- acesso, a mesma que fn_acesso_efetivo lê). Devolve id + nome (full_name, senão email) + papel.
-- Guard por empresa. Não migra nada; só leitura.

CREATE OR REPLACE FUNCTION public.fn_oficina_mecanicos_cadastrados(p_company_id uuid)
 RETURNS TABLE(id uuid, nome text, papel text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  RETURN QUERY
  SELECT u.id,
         coalesce(nullif(btrim(u.full_name), ''), u.email)::text AS nome,
         tur.role::text AS papel
  FROM tenant_user_roles tur
  JOIN users u ON u.id = tur.user_id
  WHERE tur.company_id = p_company_id
    AND coalesce(tur.is_active, true) = true
    AND tur.role IN ('OFICINA_MECANICO', 'OFICINA_DONO')
    AND coalesce(u.is_active, true) = true
  ORDER BY (tur.role = 'OFICINA_DONO'), nome;   -- mecânicos primeiro, donos depois
END $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_mecanicos_cadastrados(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_mecanicos_cadastrados(uuid) TO authenticated, service_role;
