-- ============================================================
-- FIX DEFINITIVO DO ONBOARDING POR CONVITE
-- Raiz: aceite nao provisionava (FK users falhava + erro engolido +
--       nao gravava tenant_user_roles). Corrige tudo e faz backfill.
-- ============================================================
-- Schema auditado em pre-push:
--   audit_log_global usa (tabela, acao, registro_id, valor_novo,
--   user_id, created_at) · NAO (operacao/dados_novos/executado_*).
-- ============================================================

-- 0) Garante UNIQUE p/ os ON CONFLICT (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_user_roles_user_company
  ON tenant_user_roles (user_id, company_id);

-- 1) Mapa canonico invite.role -> CLIENT_* (DECISAO DO CEO)
CREATE OR REPLACE FUNCTION public.fn_map_invite_role_to_client_role(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(p_role,''))
    WHEN 'adm'               THEN 'CLIENT_OWNER'
    WHEN 'socio'             THEN 'CLIENT_OWNER'
    WHEN 'financeiro'        THEN 'CLIENT_MANAGER'
    WHEN 'adm_investimentos' THEN 'CLIENT_MANAGER'
    WHEN 'gerente'           THEN 'CLIENT_MANAGER'
    WHEN 'operacional'       THEN 'CLIENT_OPERATOR'
    WHEN 'visualizador'      THEN 'CLIENT_VIEWER'
    ELSE 'CLIENT_VIEWER'
  END;
$$;

-- 2) Funcao REUTILIZAVEL de provisionamento (trigger E backfill chamam a mesma)
CREATE OR REPLACE FUNCTION public.fn_provisionar_acesso_por_invite(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  inv invites%ROWTYPE;
  v_areas text[];
  v_client_role text;
  v_full_name text;
  v_email text;
BEGIN
  SELECT * INTO inv FROM invites WHERE id = p_invite_id;
  IF inv.id IS NULL OR inv.used_by IS NULL OR inv.company_id IS NULL THEN RETURN; END IF;

  -- (A) RAIZ: garante o usuario em public.users (vindo do auth.users)
  SELECT au.email,
         COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email,'@',1))
    INTO v_email, v_full_name
    FROM auth.users au WHERE au.id = inv.used_by;

  INSERT INTO public.users (id, email, full_name, is_active, created_at)
  VALUES (inv.used_by, v_email, v_full_name, true, now())
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, public.users.email),
        full_name = COALESCE(public.users.full_name, EXCLUDED.full_name),
        is_active = true;

  -- (B) Papel canonico CLIENT_* -> o que role_permissions realmente le
  v_client_role := public.fn_map_invite_role_to_client_role(inv.role);

  INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by, assigned_at, observacao)
  VALUES (inv.used_by, inv.company_id, v_client_role, true, inv.created_by, now(), 'Convite '||inv.invite_code)
  ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role, is_active = true;

  -- (C) Compat: user_companies (papel amigavel do convite)
  INSERT INTO user_companies (user_id, company_id, role, created_at)
  VALUES (inv.used_by, inv.company_id, COALESCE(inv.role,'geral'), now())
  ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role;

  -- grupo: replica p/ empresas-filhas
  IF inv.group_id IS NOT NULL THEN
    INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by, assigned_at)
    SELECT inv.used_by, ch.company_id, v_client_role, true, inv.created_by, now()
    FROM company_hierarchy ch
    WHERE ch.parent_id = inv.group_id OR ch.id = inv.group_id
    ON CONFLICT (user_id, company_id) DO NOTHING;
  END IF;

  -- (D) Areas: interseccao com o teto; se NULL e for OWNER => todas as contratadas
  IF inv.areas_liberadas IS NOT NULL AND array_length(inv.areas_liberadas,1) > 0 THEN
    SELECT array_agg(s.area_slug) INTO v_areas
    FROM fn_empresa_areas_status(inv.company_id) s
    WHERE s.habilitada AND s.area_slug = ANY(inv.areas_liberadas);
  ELSIF v_client_role = 'CLIENT_OWNER' THEN
    SELECT array_agg(s.area_slug) INTO v_areas
    FROM fn_empresa_areas_status(inv.company_id) s WHERE s.habilitada;
  END IF;

  IF v_areas IS NOT NULL AND array_length(v_areas,1) > 0 THEN
    INSERT INTO user_areas_allowed (user_id, areas_allowed, restricted, motivo, granted_by, granted_at)
    VALUES (inv.used_by, v_areas, (inv.areas_liberadas IS NOT NULL), 'Provisionado via convite', inv.created_by, now())
    ON CONFLICT (user_id) DO UPDATE
      SET areas_allowed = EXCLUDED.areas_allowed, restricted = EXCLUDED.restricted,
          motivo = EXCLUDED.motivo, granted_by = EXCLUDED.granted_by, updated_at = now();
  END IF;

  -- audit: schema canonico (tabela, acao, registro_id, valor_novo, user_id, created_at)
  INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES ('tenant_user_roles','PROVISION_VIA_INVITE',inv.id::text,
    jsonb_build_object('user_id',inv.used_by,'company_id',inv.company_id,'invite_role',inv.role,'client_role',v_client_role,'areas',v_areas),
    inv.created_by, now());
END;
$fn$;

-- 3) Trigger fino: chama a funcao reutilizavel; erro NAO e mais silencioso
CREATE OR REPLACE FUNCTION public.fn_invite_consumido_criar_vinculo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $tg$
BEGIN
  IF (OLD.is_used IS DISTINCT FROM NEW.is_used) AND NEW.is_used = true
     AND NEW.used_by IS NOT NULL AND NEW.company_id IS NOT NULL THEN
    PERFORM public.fn_provisionar_acesso_por_invite(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES ('invites','PROVISION_FALHOU',NEW.id::text,
    jsonb_build_object('invite_code',NEW.invite_code,'used_by',NEW.used_by,'erro',SQLERRM),
    NEW.used_by, now());
  RETURN NEW;
END;
$tg$;

-- 4) BACKFILL: provisiona convites ja consumidos que ficaram sem papel (Fabiane + outros)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.id FROM invites i
    WHERE i.is_used = true AND i.used_by IS NOT NULL AND i.company_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM tenant_user_roles tur WHERE tur.user_id=i.used_by AND tur.company_id=i.company_id)
  LOOP
    PERFORM public.fn_provisionar_acesso_por_invite(r.id);
  END LOOP;
END $$;
