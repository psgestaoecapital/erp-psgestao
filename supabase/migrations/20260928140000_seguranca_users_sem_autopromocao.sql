-- 🚨 SEGURANÇA · HOTFIX (28/09) — qualquer usuário logado podia se promover a administrador.
--
-- A policy users_update_own deixa o logado alterar a PRÓPRIA linha de public.users, e o GRANT de UPDATE do
-- authenticated cobre todas as colunas — inclusive as que dão poder: role ('adm'/'acesso_total' → is_admin(),
-- que abre TODAS as empresas nas policies "... OR is_admin()") e system_role ('PS_ADMIN_CVM' → get_user_company_ids()
-- devolve todas as empresas, inclusive as restritas). Um único PATCH /rest/v1/users?id=eq.<eu> {"role":"adm"}.
-- Provado em rollback 28/09 com um usuário cliente: is_admin false→true; empresas visíveis 1→30; títulos a receber 339→5.501.
-- Hoje só os 4 administradores PS e o robô têm papel elevado (nenhum cliente) — sem sinal de abuso que tenha ficado.
--
-- Correção (defesa no banco, não na tela):
-- gatilho BEFORE UPDATE em users: vindo da API (current_user authenticated/anon — não service_role, não função
-- SECURITY DEFINER do dono), só administrador PS (is_admin(), lido ANTES da mudança) altera role, system_role,
-- is_active, is_robo, org_id, email ou id. O próprio usuário segue editando nome, telefone, cargo, avatar etc.
-- A tela de Acessos (admin) segue trocando o nível de outros usuários — ela roda como administrador.

CREATE OR REPLACE FUNCTION public.fn_users_protege_privilegio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.is_admin()
     AND (NEW.role        IS DISTINCT FROM OLD.role
       OR NEW.system_role IS DISTINCT FROM OLD.system_role
       OR NEW.is_active   IS DISTINCT FROM OLD.is_active
       OR NEW.is_robo     IS DISTINCT FROM OLD.is_robo
       OR NEW.org_id      IS DISTINCT FROM OLD.org_id
       OR NEW.email       IS DISTINCT FROM OLD.email
       OR NEW.id          IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'Sem permissão para alterar papel, acesso ou identificação do usuário'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.fn_users_protege_privilegio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_protege_privilegio ON public.users;
CREATE TRIGGER trg_users_protege_privilegio
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_users_protege_privilegio();
