-- ============================================================
-- FIX DEFINITIVO: convite NUNCA torna cliente admin-de-plataforma,
-- e areas concedidas SEMPRE entram como restricted=true (escopo real).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_provisionar_acesso_por_invite(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  inv invites%ROWTYPE;
  v_areas text[];
  v_client_role text;
  v_full_name text;
  v_email text;
BEGIN
  SELECT * INTO inv FROM invites WHERE id = p_invite_id;
  IF inv.id IS NULL OR inv.used_by IS NULL OR inv.company_id IS NULL THEN RETURN; END IF;

  -- (A) RAIZ: garante o usuario em public.users
  SELECT au.email,
         COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name')
    INTO v_email, v_full_name
    FROM auth.users au WHERE au.id = inv.used_by;
  v_email     := COALESCE(v_email, inv.email);
  v_full_name := COALESCE(v_full_name, split_part(COALESCE(v_email,'usuario@local'),'@',1));

  -- role (legado): valido no users_role_check E NUNCA admin-de-plataforma.
  -- 'adm'/'admin'/'acesso_total' disparam is_admin()/area-admin => viram 'socio'.
  INSERT INTO public.users (id, email, full_name, role, is_active, created_at)
  VALUES (
    inv.used_by, v_email, v_full_name,
    CASE
      WHEN inv.role IN ('adm','admin','acesso_total') THEN 'socio'
      WHEN inv.role IN ('adm_investimentos','socio','diretor_industrial','gerente_planta','financeiro',
        'comercial','supervisor','coordenador','operacional','consultor','conselheiro','visualizador',
        'operador_bpo','supervisor_bpo','gestor_mfo','analista','cliente_pf','compliance','contador',
        'dev','wealth_advisor','viewer') THEN inv.role
      ELSE 'viewer'
    END,
    true, now())
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.users.email),
        full_name = COALESCE(public.users.full_name, EXCLUDED.full_name),
        is_active = true;

  -- (B) Papel canonico CLIENT_*
  v_client_role := public.fn_map_invite_role_to_client_role(inv.role);
  INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by, assigned_at, observacao)
  VALUES (inv.used_by, inv.company_id, v_client_role, true, inv.created_by, now(), 'Convite '||inv.invite_code)
  ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role, is_active = true;

  -- (C) Compat: user_companies
  INSERT INTO user_companies (user_id, company_id, role, created_at)
  VALUES (inv.used_by, inv.company_id, COALESCE(inv.role,'geral'), now())
  ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role;

  IF inv.group_id IS NOT NULL THEN
    INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by, assigned_at)
    SELECT inv.used_by, ch.company_id, v_client_role, true, inv.created_by, now()
    FROM company_hierarchy ch
    WHERE ch.parent_id = inv.group_id OR ch.id = inv.group_id
    ON CONFLICT (user_id, company_id) DO NOTHING;
  END IF;

  -- (D) Areas
  IF inv.areas_liberadas IS NOT NULL AND array_length(inv.areas_liberadas,1) > 0 THEN
    SELECT array_agg(s.area_slug) INTO v_areas
    FROM fn_empresa_areas_status(inv.company_id) s
    WHERE s.habilitada AND s.area_slug = ANY(inv.areas_liberadas);
  ELSIF v_client_role = 'CLIENT_OWNER' THEN
    SELECT array_agg(s.area_slug) INTO v_areas
    FROM fn_empresa_areas_status(inv.company_id) s WHERE s.habilitada;
  END IF;

  -- restricted SEMPRE true ao conceder areas. false = "ve todas as areas" (vazamento).
  IF v_areas IS NOT NULL AND array_length(v_areas,1) > 0 THEN
    INSERT INTO user_areas_allowed (user_id, areas_allowed, restricted, motivo, granted_by, granted_at)
    VALUES (inv.used_by, v_areas, true, 'Provisionado via convite', inv.created_by, now())
    ON CONFLICT (user_id) DO UPDATE
      SET areas_allowed = EXCLUDED.areas_allowed, restricted = true,
          motivo = EXCLUDED.motivo, granted_by = EXCLUDED.granted_by, updated_at = now();
  END IF;

  INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES ('tenant_user_roles','PROVISION_VIA_INVITE',inv.id::text,
    jsonb_build_object('user_id',inv.used_by,'company_id',inv.company_id,'invite_role',inv.role,'client_role',v_client_role,'areas',v_areas),
    inv.created_by, now());
END;
$function$;

-- HARDENING idempotente (reforca o que ja foi corrigido a mao)
-- 1) Nenhum CLIENTE (sem system_role) pode ter users.role admin-de-plataforma
UPDATE public.users u
SET role = 'socio'
WHERE u.role IN ('adm','admin','acesso_total')
  AND u.system_role IS NULL
  AND EXISTS (SELECT 1 FROM tenant_user_roles t WHERE t.user_id = u.id
              AND t.role IN ('CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER'));

-- 2) Todo cliente com areas concedidas deve estar restricted=true (senao ve todas)
UPDATE user_areas_allowed uaa
SET restricted = true, updated_at = now()
FROM users u
WHERE u.id = uaa.user_id
  AND uaa.restricted = false
  AND u.system_role IS NULL
  AND array_length(uaa.areas_allowed,1) > 0;
