-- PARTE B · GAP 1 — Incluir pessoa nova pela tela de Acessos (genérico, todas as empresas/áreas).
--
-- Hoje fn_acessos_salvar_pessoa exige p_user_id (só EDITA quem já existe). Falta convidar/incluir.
-- Estratégia: se o e-mail JÁ existe em users → vincula direto; senão → cria invite com TODAS as
-- permissões (áreas, nível, plantas, horário, papel de gestão) e devolve o link; no aceite,
-- fn_provisionar_acesso_por_invite aplica tudo.
--
-- Guards (RD-25): fn_acessos_pode_gerir (CLIENT_OWNER ou PS_ADMIN); áreas ⊆ contratadas (teto);
-- nível NUNCA admin/acesso_total/PS_ADMIN; só CLIENT_OWNER concede CLIENT_OWNER.

-- 1) invites carrega as permissões que faltavam
ALTER TABLE public.invites ADD COLUMN IF NOT EXISTS plantas uuid[];
ALTER TABLE public.invites ADD COLUMN IF NOT EXISTS horario jsonb;
ALTER TABLE public.invites ADD COLUMN IF NOT EXISTS client_role text;

-- 2) provisionar passa a aplicar plantas/horário e a honrar o client_role do convite
CREATE OR REPLACE FUNCTION public.fn_provisionar_acesso_por_invite(p_invite_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- (B) Papel canonico CLIENT_* — honra o client_role do convite quando presente
  v_client_role := COALESCE(NULLIF(inv.client_role,''), public.fn_map_invite_role_to_client_role(inv.role));
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

  IF v_areas IS NOT NULL AND array_length(v_areas,1) > 0 THEN
    INSERT INTO user_areas_allowed (user_id, areas_allowed, restricted, motivo, granted_by, granted_at)
    VALUES (inv.used_by, v_areas, true, 'Provisionado via convite', inv.created_by, now())
    ON CONFLICT (user_id) DO UPDATE
      SET areas_allowed = EXCLUDED.areas_allowed, restricted = true,
          motivo = EXCLUDED.motivo, granted_by = EXCLUDED.granted_by, updated_at = now();
  END IF;

  -- (E) Plantas (novo — vindas do convite)
  IF inv.plantas IS NOT NULL AND array_length(inv.plantas,1) > 0 THEN
    DELETE FROM user_plantas WHERE user_id = inv.used_by AND company_id = inv.company_id;
    INSERT INTO user_plantas (user_id, plant_id, company_id)
    SELECT inv.used_by, pid, inv.company_id
    FROM unnest(inv.plantas) pid
    WHERE EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = pid AND ip.company_id = inv.company_id)
    ON CONFLICT (user_id, plant_id) DO NOTHING;
  END IF;

  -- (F) Horario (novo — vindo do convite)
  IF inv.horario IS NOT NULL AND inv.horario <> 'null'::jsonb THEN
    INSERT INTO user_horario_acesso (user_id, company_id, dias_semana, hora_inicio, hora_fim, timezone, ativo, updated_at)
    VALUES (inv.used_by, inv.company_id,
      COALESCE((SELECT array_agg((x)::int) FROM jsonb_array_elements_text(COALESCE(inv.horario->'dias_semana','[]'::jsonb)) x),'{}'),
      NULLIF(inv.horario->>'hora_inicio','')::time, NULLIF(inv.horario->>'hora_fim','')::time,
      COALESCE(NULLIF(inv.horario->>'timezone',''),'America/Sao_Paulo'),
      COALESCE((inv.horario->>'ativo')::boolean,true), now())
    ON CONFLICT (user_id, company_id) DO UPDATE SET dias_semana = EXCLUDED.dias_semana, hora_inicio = EXCLUDED.hora_inicio,
      hora_fim = EXCLUDED.hora_fim, timezone = EXCLUDED.timezone, ativo = EXCLUDED.ativo, updated_at = now();
  END IF;

  INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES ('tenant_user_roles','PROVISION_VIA_INVITE',inv.id::text,
    jsonb_build_object('user_id',inv.used_by,'company_id',inv.company_id,'invite_role',inv.role,'client_role',v_client_role,'areas',v_areas),
    inv.created_by, now());
END;
$function$;

-- 3) Convidar/incluir pessoa (vínculo direto se já existe; senão convite)
CREATE OR REPLACE FUNCTION public.fn_acessos_convidar_pessoa(
  p_company_id uuid,
  p_email text,
  p_nome text DEFAULT NULL,
  p_areas text[] DEFAULT NULL,
  p_role text DEFAULT 'viewer',
  p_plantas uuid[] DEFAULT NULL,
  p_horario jsonb DEFAULT NULL,
  p_papel_gestao text DEFAULT 'CLIENT_VIEWER'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email  text := lower(btrim(coalesce(p_email,'')));
  v_role   text := lower(btrim(coalesce(p_role,'viewer')));
  v_papel  text := upper(btrim(coalesce(p_papel_gestao,'CLIENT_VIEWER')));
  v_caller uuid := auth.uid();
  v_caller_owner boolean;
  v_uid uuid;
  v_invite_id uuid;
  v_code text;
  v_contratadas text[];
  v_bad text[];
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe um e-mail válido.');
  END IF;

  IF v_papel NOT IN ('CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER') THEN
    v_papel := 'CLIENT_VIEWER';
  END IF;
  v_caller_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true)
                 OR EXISTS (SELECT 1 FROM users WHERE id=v_caller AND system_role='PS_ADMIN');
  IF v_papel='CLIENT_OWNER' AND NOT v_caller_owner THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só um master pode conceder o papel de master.');
  END IF;

  -- nível nunca admin/acesso_total/PS_ADMIN; desconhecido resolvido no aceite/edição
  IF v_role IN ('adm','admin','acesso_total','ps_admin','adm_investimentos') OR public.fn_role_to_nivel(v_role)='administrador' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nível não permitido (sem escalação para admin).');
  END IF;

  -- teto de áreas contratadas
  SELECT array_agg(area_slug) INTO v_contratadas FROM fn_empresa_areas_status(p_company_id) WHERE habilitada;
  IF p_areas IS NOT NULL THEN
    SELECT array_agg(a) INTO v_bad FROM unnest(p_areas) a WHERE a <> ALL(COALESCE(v_contratadas,'{}'));
    IF v_bad IS NOT NULL AND cardinality(v_bad) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Área(s) não contratada(s): '||array_to_string(v_bad,', '));
    END IF;
  END IF;

  -- plantas devem ser da empresa
  IF p_plantas IS NOT NULL AND cardinality(p_plantas) > 0 THEN
    IF EXISTS (SELECT 1 FROM unnest(p_plantas) pid WHERE NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id=pid AND ip.company_id=p_company_id)) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Planta(s) não pertencem a esta empresa.');
    END IF;
  END IF;

  SELECT id INTO v_uid FROM users WHERE lower(email)=v_email LIMIT 1;

  IF v_uid IS NOT NULL THEN
    -- VÍNCULO DIRETO (usuário já existe)
    INSERT INTO user_companies (user_id, company_id, role, created_at)
    VALUES (v_uid, p_company_id, v_role, now())
    ON CONFLICT (user_id, company_id) DO UPDATE SET role=EXCLUDED.role;

    INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by, assigned_at, observacao)
    VALUES (v_uid, p_company_id, v_papel, true, v_caller, now(), 'Vinculado via Acessos')
    ON CONFLICT (user_id, company_id) DO UPDATE SET role=EXCLUDED.role, is_active=true, assigned_by=v_caller, assigned_at=now();

    IF p_areas IS NOT NULL AND cardinality(p_areas) > 0 THEN
      INSERT INTO user_areas_allowed (user_id, areas_allowed, restricted, motivo, granted_by, granted_at, updated_at)
      VALUES (v_uid, p_areas, true, 'Concedido via Acessos', v_caller, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET areas_allowed=EXCLUDED.areas_allowed, restricted=true, granted_by=v_caller, updated_at=now();
    END IF;

    IF p_plantas IS NOT NULL AND cardinality(p_plantas) > 0 THEN
      DELETE FROM user_plantas WHERE user_id=v_uid AND company_id=p_company_id;
      INSERT INTO user_plantas (user_id, plant_id, company_id)
      SELECT v_uid, pid, p_company_id FROM unnest(p_plantas) pid ON CONFLICT (user_id, plant_id) DO NOTHING;
    END IF;

    IF p_horario IS NOT NULL AND p_horario <> 'null'::jsonb THEN
      INSERT INTO user_horario_acesso (user_id, company_id, dias_semana, hora_inicio, hora_fim, timezone, ativo, updated_at)
      VALUES (v_uid, p_company_id,
        COALESCE((SELECT array_agg((x)::int) FROM jsonb_array_elements_text(COALESCE(p_horario->'dias_semana','[]'::jsonb)) x),'{}'),
        NULLIF(p_horario->>'hora_inicio','')::time, NULLIF(p_horario->>'hora_fim','')::time,
        COALESCE(NULLIF(p_horario->>'timezone',''),'America/Sao_Paulo'),
        COALESCE((p_horario->>'ativo')::boolean,true), now())
      ON CONFLICT (user_id, company_id) DO UPDATE SET dias_semana=EXCLUDED.dias_semana, hora_inicio=EXCLUDED.hora_inicio,
        hora_fim=EXCLUDED.hora_fim, timezone=EXCLUDED.timezone, ativo=EXCLUDED.ativo, updated_at=now();
    END IF;

    INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
    VALUES ('tenant_user_roles','ACESSO_VINCULO_DIRETO', v_uid::text,
      jsonb_build_object('company_id',p_company_id,'role',v_role,'papel',v_papel,'areas',p_areas), v_caller, now());

    RETURN jsonb_build_object('ok', true, 'acao','vinculado', 'user_id', v_uid);
  ELSE
    -- CONVITE (usuário não existe)
    v_code := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO invites (company_id, email, role, invite_code, created_by, areas_liberadas, plantas, horario, client_role, expires_at, is_used, created_at)
    VALUES (p_company_id, v_email, v_role, v_code, v_caller, p_areas, p_plantas, p_horario, v_papel, now()+interval '14 days', false, now())
    RETURNING id INTO v_invite_id;

    INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
    VALUES ('invites','ACESSO_CONVITE_CRIADO', v_invite_id::text,
      jsonb_build_object('company_id',p_company_id,'email',v_email,'role',v_role,'papel',v_papel), v_caller, now());

    RETURN jsonb_build_object('ok', true, 'acao','convidado', 'invite_id', v_invite_id,
      'invite_code', v_code, 'link', '/convite?code='||v_code);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_acessos_convidar_pessoa(uuid,text,text,text[],text,uuid[],jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_acessos_convidar_pessoa(uuid,text,text,text[],text,uuid[],jsonb,text) TO authenticated;
