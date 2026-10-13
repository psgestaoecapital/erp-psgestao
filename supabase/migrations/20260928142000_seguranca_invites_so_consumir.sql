-- 🚨 SEGURANÇA · HOTFIX (28/09) — qualquer usuário logado podia virar DONO de qualquer empresa por um convite.
--
-- invites_update_authenticated é USING(true) WITH CHECK(true): o logado altera QUALQUER convite. E o gatilho
-- trg_invite_consumido_criar_vinculo (SECURITY DEFINER) provisiona acesso quando is_used vira true — com a empresa,
-- o papel e o client_role QUE ESTIVEREM NO CONVITE. Bastava pegar um convite (os códigos são legíveis pelo anon),
-- trocar company_id para a empresa-alvo, used_by para si, client_role para CLIENT_OWNER e virar is_used.
-- Provado em rollback 28/09: usuário cliente ganhou acesso a outra empresa como CLIENT_OWNER.
--
-- Correção (defesa no banco): gatilho BEFORE UPDATE em invites. Vindo da API (authenticated/anon) e sem ser
-- administrador PS, a ÚNICA mudança aceita é a que a página /convite faz ao aceitar: is_used false→true, used_by =
-- o próprio usuário, used_at, e NADA MAIS; convite não vencido; e, se o convite tem e-mail, o e-mail da conta
-- (JWT) tem de ser o mesmo — código vazado não serve para outra pessoa. Admin PS e funções SECURITY DEFINER seguem
-- livres. A troca definitiva (RPC de aceite + fim da leitura anônima dos convites) vem em PR própria.

CREATE OR REPLACE FUNCTION public.fn_invites_protege_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL
     AND OLD.is_used IS NOT TRUE AND NEW.is_used = true
     AND NEW.used_by = auth.uid()
     AND (OLD.expires_at IS NULL OR OLD.expires_at > now())
     AND (OLD.email IS NULL OR btrim(OLD.email) = ''
          OR lower(btrim(OLD.email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id
     AND NEW.email IS NOT DISTINCT FROM OLD.email
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.client_role IS NOT DISTINCT FROM OLD.client_role
     AND NEW.invite_code IS NOT DISTINCT FROM OLD.invite_code
     AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.areas_liberadas IS NOT DISTINCT FROM OLD.areas_liberadas
     AND NEW.plantas IS NOT DISTINCT FROM OLD.plantas
     AND NEW.horario IS NOT DISTINCT FROM OLD.horario THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Convite: só é possível aceitar o próprio convite (válido e para o seu e-mail)'
    USING ERRCODE = '42501';
END $function$;

REVOKE ALL ON FUNCTION public.fn_invites_protege_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_invites_protege_update ON public.invites;
CREATE TRIGGER trg_invites_protege_update
  BEFORE UPDATE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.fn_invites_protege_update();
