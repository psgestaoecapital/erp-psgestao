-- RD-41 · PACOTE ADMIN · SPEC 🅲 — Convite + acesso na hora + fix da raiz (todos os usuários).
-- 1) fn_acessos_salvar_pessoa: areas_allowed é GLOBAL por usuário, mas o teto é por empresa.
--    Um usuário em N empresas (ex.: Jordana em 10) só conseguia marcar áreas contratadas na
--    empresa aberta — marcar uma área contratada por OUTRA empresa dele era rejeitada e o Salvar
--    "não pegava". Correção: validar contra a UNIÃO dos tetos das empresas do usuário (o efetivo
--    por empresa continua sendo a INTERSEÇÃO no acesso). Grava exato (atômico) e ECOA as áreas.
-- 2) fn_acessos_convidar_pessoa / fn_admin_reenviar_acesso: enviam o email (🅰️, fn_enviar_email)
--    além de devolver o link — os dois. Idempotente pelo invite_code.
-- Sem cleanup de áreas inválidas: 0 usuários com área fora do teto (nada a sanear).

-- ─────────────────────────────────────────────────────────────
-- 1 · SALVAR: valida contra a UNIÃO dos tetos + retorna as áreas persistidas
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_acessos_salvar_pessoa(p_company_id uuid, p_user_id uuid, p_areas text[], p_role text, p_plantas uuid[], p_horario jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role_norm text; v_role_final text; v_contratadas text[]; v_bad text[]; v_bad_plant int; v_persist text[];
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = p_user_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

  -- teto = UNIÃO das áreas contratadas de TODAS as empresas do usuário (areas_allowed é global).
  SELECT array_agg(DISTINCT s.area_slug) INTO v_contratadas
  FROM user_companies uc
  JOIN fn_empresa_areas_status(uc.company_id) s ON s.habilitada
  WHERE uc.user_id = p_user_id;

  IF p_areas IS NOT NULL THEN
    SELECT array_agg(a) INTO v_bad FROM unnest(p_areas) a WHERE a <> ALL(COALESCE(v_contratadas, '{}'));
    IF v_bad IS NOT NULL AND cardinality(v_bad) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Área(s) não contratada(s) em nenhuma empresa do usuário: ' || array_to_string(v_bad, ', '));
    END IF;
  END IF;

  v_role_norm := lower(btrim(coalesce(p_role, '')));
  IF v_role_norm IN ('adm','admin','acesso_total','ps_admin') OR public.fn_role_to_nivel(p_role) = 'administrador' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Papel não permitido (sem escalação para admin).');
  END IF;
  v_role_final := CASE WHEN v_role_norm IN ('socio','sócio','diretor','gerente','comercial','financeiro','consultor',
      'contador','coordenador','operacional','supervisor','cliente_bpo','cliente_wealth','diretor_area','gerente_planta',
      'gerente_processo','supervisor_turno','operador','rh_industrial','sst','viewer') THEN v_role_norm ELSE 'viewer' END;

  IF p_plantas IS NOT NULL AND cardinality(p_plantas) > 0 THEN
    SELECT count(*) INTO v_bad_plant FROM unnest(p_plantas) pid
      WHERE NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = pid AND ip.company_id = p_company_id);
    IF v_bad_plant > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Planta(s) não pertencem a esta empresa.');
    END IF;
  END IF;

  UPDATE users SET role = v_role_final WHERE id = p_user_id;
  UPDATE user_companies SET role = v_role_final WHERE user_id = p_user_id AND company_id = p_company_id;

  IF p_areas IS NOT NULL THEN
    INSERT INTO user_areas_allowed (user_id, areas_allowed, restricted, granted_by, granted_at, updated_at)
    VALUES (p_user_id, p_areas, true, auth.uid(), now(), now())
    ON CONFLICT (user_id) DO UPDATE SET areas_allowed = EXCLUDED.areas_allowed, restricted = true,
      granted_by = EXCLUDED.granted_by, granted_at = now(), updated_at = now();
  END IF;

  DELETE FROM user_plantas WHERE user_id = p_user_id AND company_id = p_company_id;
  IF p_plantas IS NOT NULL AND cardinality(p_plantas) > 0 THEN
    INSERT INTO user_plantas (user_id, plant_id, company_id)
    SELECT p_user_id, pid, p_company_id FROM unnest(p_plantas) pid
    ON CONFLICT (user_id, plant_id) DO NOTHING;
  END IF;

  IF p_horario IS NOT NULL AND p_horario <> 'null'::jsonb THEN
    INSERT INTO user_horario_acesso (user_id, company_id, dias_semana, hora_inicio, hora_fim, timezone, ativo, updated_at)
    VALUES (p_user_id, p_company_id,
      COALESCE((SELECT array_agg((x)::int) FROM jsonb_array_elements_text(coalesce(p_horario->'dias_semana', '[]'::jsonb)) x), '{}'),
      NULLIF(p_horario->>'hora_inicio', '')::time, NULLIF(p_horario->>'hora_fim', '')::time,
      COALESCE(NULLIF(p_horario->>'timezone', ''), 'America/Sao_Paulo'),
      COALESCE((p_horario->>'ativo')::boolean, true), now())
    ON CONFLICT (user_id, company_id) DO UPDATE SET dias_semana = EXCLUDED.dias_semana, hora_inicio = EXCLUDED.hora_inicio,
      hora_fim = EXCLUDED.hora_fim, timezone = EXCLUDED.timezone, ativo = EXCLUDED.ativo, updated_at = now();
  END IF;

  PERFORM public.fn_provisionar_user_scope(p_user_id, p_company_id, v_role_final, p_areas);

  -- ecoa exatamente o que ficou gravado (fonte única de verdade p/ o front confirmar)
  SELECT areas_allowed INTO v_persist FROM user_areas_allowed WHERE user_id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'role', v_role_final, 'areas', to_jsonb(COALESCE(v_persist, p_areas)));
END $function$;

-- ─────────────────────────────────────────────────────────────
-- 2 · CONVIDAR: cria o convite (como hoje) E envia o email (🅰️). p_base_url = origem do app
--     (o banco não conhece o host) → link absoluto no email. Retorna link + email_enviado.
--     Dropa a arity antiga (8 args) p/ não deixar overload sem email.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_acessos_convidar_pessoa(uuid, text, text, text[], text, uuid[], jsonb, text);
CREATE OR REPLACE FUNCTION public.fn_acessos_convidar_pessoa(p_company_id uuid, p_email text, p_nome text DEFAULT NULL::text, p_areas text[] DEFAULT NULL::text[], p_role text DEFAULT 'viewer'::text, p_plantas uuid[] DEFAULT NULL::uuid[], p_horario jsonb DEFAULT NULL::jsonb, p_papel_gestao text DEFAULT 'CLIENT_VIEWER'::text, p_base_url text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(coalesce(p_email,''))); v_role text := lower(btrim(coalesce(p_role,'viewer')));
  v_papel text := upper(btrim(coalesce(p_papel_gestao,'CLIENT_VIEWER'))); v_caller uuid := auth.uid();
  v_caller_owner boolean; v_uid uuid; v_invite_id uuid; v_code text; v_contratadas text[]; v_bad text[];
  v_link text; v_mail jsonb; v_empresa text;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.'); END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe um e-mail válido.'); END IF;
  IF v_papel NOT IN ('CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER') THEN v_papel := 'CLIENT_VIEWER'; END IF;
  v_caller_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true)
                 OR EXISTS (SELECT 1 FROM users WHERE id=v_caller AND system_role='PS_ADMIN');
  IF v_papel='CLIENT_OWNER' AND NOT v_caller_owner THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só um master pode conceder o papel de master.'); END IF;
  IF v_role IN ('adm','admin','acesso_total','ps_admin','adm_investimentos') OR public.fn_role_to_nivel(v_role)='administrador' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nível não permitido (sem escalação para admin).'); END IF;

  -- convite entra em UMA empresa → teto dessa empresa
  SELECT array_agg(area_slug) INTO v_contratadas FROM fn_empresa_areas_status(p_company_id) WHERE habilitada;
  IF p_areas IS NOT NULL THEN
    SELECT array_agg(a) INTO v_bad FROM unnest(p_areas) a WHERE a <> ALL(COALESCE(v_contratadas,'{}'));
    IF v_bad IS NOT NULL AND cardinality(v_bad) > 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Área(s) não contratada(s): '||array_to_string(v_bad,', ')); END IF;
  END IF;
  IF p_plantas IS NOT NULL AND cardinality(p_plantas) > 0 THEN
    IF EXISTS (SELECT 1 FROM unnest(p_plantas) pid WHERE NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id=pid AND ip.company_id=p_company_id)) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Planta(s) não pertencem a esta empresa.'); END IF;
  END IF;

  SELECT id INTO v_uid FROM users WHERE lower(email)=v_email LIMIT 1;

  IF v_uid IS NOT NULL THEN
    INSERT INTO user_companies (user_id, company_id, role, created_at) VALUES (v_uid, p_company_id, v_role, now())
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
      INSERT INTO user_plantas (user_id, plant_id, company_id) SELECT v_uid, pid, p_company_id FROM unnest(p_plantas) pid ON CONFLICT (user_id, plant_id) DO NOTHING;
    END IF;
    IF p_horario IS NOT NULL AND p_horario <> 'null'::jsonb THEN
      INSERT INTO user_horario_acesso (user_id, company_id, dias_semana, hora_inicio, hora_fim, timezone, ativo, updated_at)
      VALUES (v_uid, p_company_id,
        COALESCE((SELECT array_agg((x)::int) FROM jsonb_array_elements_text(COALESCE(p_horario->'dias_semana','[]'::jsonb)) x),'{}'),
        NULLIF(p_horario->>'hora_inicio','')::time, NULLIF(p_horario->>'hora_fim','')::time,
        COALESCE(NULLIF(p_horario->>'timezone',''),'America/Sao_Paulo'), COALESCE((p_horario->>'ativo')::boolean,true), now())
      ON CONFLICT (user_id, company_id) DO UPDATE SET dias_semana=EXCLUDED.dias_semana, hora_inicio=EXCLUDED.hora_inicio,
        hora_fim=EXCLUDED.hora_fim, timezone=EXCLUDED.timezone, ativo=EXCLUDED.ativo, updated_at=now();
    END IF;

    PERFORM public.fn_provisionar_user_scope(v_uid, p_company_id, v_role, p_areas);

    INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
    VALUES ('tenant_user_roles','ACESSO_VINCULO_DIRETO', v_uid::text, jsonb_build_object('company_id',p_company_id,'role',v_role,'papel',v_papel,'areas',p_areas), v_caller, now());
    RETURN jsonb_build_object('ok', true, 'acao','vinculado', 'user_id', v_uid);
  ELSE
    v_code := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO invites (company_id, email, role, invite_code, created_by, areas_liberadas, plantas, horario, client_role, expires_at, is_used, created_at)
    VALUES (p_company_id, v_email, v_role, v_code, v_caller, p_areas, p_plantas, p_horario, v_papel, now()+interval '14 days', false, now()) RETURNING id INTO v_invite_id;
    INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
    VALUES ('invites','ACESSO_CONVITE_CRIADO', v_invite_id::text, jsonb_build_object('company_id',p_company_id,'email',v_email,'role',v_role,'papel',v_papel), v_caller, now());

    -- 🅰️ envia o email (além do link). link absoluto exige o host (p_base_url).
    v_link := COALESCE(NULLIF(rtrim(p_base_url,'/'),''),'') || '/convite?code=' || v_code;
    SELECT nome_fantasia INTO v_empresa FROM companies WHERE id = p_company_id;
    v_mail := public.fn_enviar_email(v_email, 'convite',
      jsonb_build_object('nome', p_nome, 'empresa', v_empresa, 'link', v_link, 'idempotency_key', v_code, 'company_id', p_company_id));

    RETURN jsonb_build_object('ok', true, 'acao','convidado', 'invite_id', v_invite_id, 'invite_code', v_code,
      'link', '/convite?code='||v_code, 'email_enviado', COALESCE((v_mail->>'ok')::boolean, false), 'email_erro', v_mail->>'erro');
  END IF;
END; $function$;

-- ─────────────────────────────────────────────────────────────
-- 3 · REENVIAR: mantém a lógica atual e passa a ENVIAR o email do convite (🅰️).
--     Dropa a arity antiga (3 args).
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_admin_reenviar_acesso(text, uuid, text);
CREATE OR REPLACE FUNCTION public.fn_admin_reenviar_acesso(p_email text, p_company_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_base_url text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid; v_company_id uuid; v_role text; v_org_id uuid; v_new_code text; v_invite_id uuid;
  v_invites_invalidados int := 0; v_link text; v_mail jsonb; v_empresa text; v_novo boolean;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Apenas administradores podem reenviar acessos'; END IF;
  IF p_email IS NULL OR p_email = '' THEN RAISE EXCEPTION 'Email e obrigatorio'; END IF;

  SELECT u.id INTO v_user_id FROM auth.users u WHERE LOWER(u.email) = LOWER(p_email);
  v_novo := v_user_id IS NULL;

  IF p_company_id IS NOT NULL THEN v_company_id := p_company_id;
  ELSIF v_user_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id FROM user_companies WHERE user_id = v_user_id ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF p_role IS NOT NULL THEN v_role := p_role;
  ELSIF v_user_id IS NOT NULL AND v_company_id IS NOT NULL THEN
    SELECT role INTO v_role FROM user_companies WHERE user_id = v_user_id AND company_id = v_company_id LIMIT 1;
  END IF;
  v_role := COALESCE(v_role, 'operacional');

  SELECT org_id INTO v_org_id FROM companies WHERE id = v_company_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Empresa nao identificada - passe company_id explicito'; END IF;

  UPDATE invites SET is_used = true, used_at = NOW() WHERE email = p_email AND is_used = false;
  GET DIAGNOSTICS v_invites_invalidados = ROW_COUNT;

  v_new_code := 'conv_' || LOWER(REPLACE(gen_random_uuid()::text, '-', ''))::text;
  v_new_code := SUBSTRING(v_new_code FROM 1 FOR 25);

  INSERT INTO invites (org_id, company_id, email, role, invite_code, created_by, expires_at, is_used, created_at)
  VALUES (v_org_id, v_company_id, p_email, v_role, v_new_code, auth.uid(), NOW() + INTERVAL '7 days', false, NOW())
  RETURNING id INTO v_invite_id;

  -- 🅰️ envia o email (novo usuário → convite; existente → orientação de login com o mesmo template).
  v_link := COALESCE(NULLIF(rtrim(p_base_url,'/'),''),'') || '/convite?code=' || v_new_code;
  SELECT nome_fantasia INTO v_empresa FROM companies WHERE id = v_company_id;
  v_mail := public.fn_enviar_email(p_email, 'convite',
    jsonb_build_object('empresa', v_empresa, 'link', v_link, 'idempotency_key', v_new_code, 'company_id', v_company_id));

  RETURN jsonb_build_object(
    'sucesso', true, 'email', p_email, 'novo_codigo', v_new_code, 'expira_em', NOW() + INTERVAL '7 days',
    'invites_invalidados', v_invites_invalidados, 'usuario_existe', NOT v_novo,
    'email_enviado', COALESCE((v_mail->>'ok')::boolean, false), 'email_erro', v_mail->>'erro',
    'link_convite', '/convite?code=' || v_new_code, 'link_login', '/login',
    'tipo_acao', CASE WHEN v_novo THEN 'NOVO_USUARIO' ELSE 'CONVITE_REENVIADO' END
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('sucesso', false, 'erro', SQLERRM, 'detalhe', SQLSTATE);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_acessos_convidar_pessoa(uuid, text, text, text[], text, uuid[], jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_reenviar_acesso(text, uuid, text, text) TO authenticated;
