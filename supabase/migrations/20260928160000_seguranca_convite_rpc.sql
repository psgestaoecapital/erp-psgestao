-- 🚨 SEGURANÇA · PR 5 (CEO 28/09) — convites.
--
-- Furo: a policy "Anyone can read invite" (SELECT true para PUBLIC) deixava QUALQUER UM, sem login, listar todos os
-- convites — código, e-mail, papel, empresa. Com o código na mão, convite sem e-mail vinculado (2 abertos hoje) é
-- aceito por quem chegar primeiro e ganha acesso à empresa. O logado comum também via os 73 convites de todas as
-- empresas.
--
-- Por que não bastava apagar a policy: a página pública /convite lê o convite pelo código (como anon) e o consome
-- com UPDATE ... WHERE invite_code = X. Sem a leitura aberta, o recém-cadastrado não "vê" a linha e o UPDATE casa 0
-- linhas — o convite nunca seria consumido e o acesso nunca provisionado (hoje: 11 aceites em 30 dias, 0 falhas).
--
-- Tratamento:
--  (1) fn_convite_ler(code): devolve SÓ o convite daquele código, se aberto e no prazo (anon e logado).
--  (2) fn_convite_aceitar(code): o logado aceita o PRÓPRIO convite — mesmas regras do gatilho fn_invites_protege_update
--      (não usado, no prazo, e-mail do convite = e-mail do login). Marca usado → o gatilho existente
--      fn_invite_consumido_criar_vinculo provisiona (perfil, empresa, papel, áreas) como hoje.
--  (3) sai "Anyone can read invite"; anon sem GRANT; UPDATE direto só da empresa do usuário (o gatilho fica).
--  A tela de admin (convidar/listar/excluir) segue pelas policies invites_*_tenant.

CREATE OR REPLACE FUNCTION public.fn_convite_ler(p_code text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((
    SELECT jsonb_build_object('ok', true, 'email', i.email, 'role', i.role, 'org_id', i.org_id,
      'company_id', i.company_id, 'group_id', i.group_id,
      'empresa', coalesce(c.nome_fantasia, c.razao_social), 'organizacao', o.name)
    FROM invites i
    LEFT JOIN companies c ON c.id = i.company_id
    LEFT JOIN organizations o ON o.id = i.org_id
    WHERE length(coalesce(p_code, '')) >= 6 AND i.invite_code = p_code
      AND i.is_used IS NOT TRUE AND (i.expires_at IS NULL OR i.expires_at > now())
    LIMIT 1), jsonb_build_object('ok', false))
$$;
REVOKE ALL ON FUNCTION public.fn_convite_ler(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_convite_ler(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_convite_aceitar(p_code text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); inv invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  SELECT * INTO inv FROM invites WHERE invite_code = p_code AND length(coalesce(p_code, '')) >= 6 FOR UPDATE;
  IF inv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'convite_invalido'); END IF;
  IF inv.is_used IS TRUE THEN
    -- reenvio do mesmo usuário (duplo clique / volta da tela) não é erro
    IF inv.used_by = v_uid THEN RETURN jsonb_build_object('ok', true, 'ja_aceito', true); END IF;
    RETURN jsonb_build_object('ok', false, 'erro', 'convite_ja_usado');
  END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'erro', 'convite_expirado'); END IF;
  IF NOT (inv.email IS NULL OR btrim(inv.email) = '' OR lower(btrim(inv.email)) = v_email) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'email_diferente');
  END IF;
  UPDATE invites SET is_used = true, used_by = v_uid, used_at = now() WHERE id = inv.id;  -- gatilho provisiona
  RETURN jsonb_build_object('ok', true, 'company_id', inv.company_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_convite_aceitar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_convite_aceitar(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can read invite" ON public.invites;
REVOKE ALL ON TABLE public.invites FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.invites FROM authenticated;
GRANT ALL ON TABLE public.invites TO service_role;

-- UPDATE direto: só quem administra convites da empresa (ou admin PS) — o aceite vai pela RPC; o gatilho
-- fn_invites_protege_update segue como segunda trava
DROP POLICY IF EXISTS invites_update_authenticated ON public.invites;
CREATE POLICY invites_update_authenticated ON public.invites FOR UPDATE TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invites'
             AND ('anon' = ANY(roles) OR 'public' = ANY(roles))) THEN
    RAISE EXCEPTION 'PR5: invites ainda tem policy para anon/PUBLIC';
  END IF;
END $$;
