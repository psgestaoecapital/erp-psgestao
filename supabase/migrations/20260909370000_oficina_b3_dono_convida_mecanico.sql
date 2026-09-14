-- ============================================================
-- Oficina · Wave B.3 (backend) · o dono da oficina convida mecanico
-- SPEC "Oficina · Papeis do dono e do mecanico" (09/09) §4. Regras do CEO:
--   - o dono convida mecanico;
--   - o dono NAO cria dono (subir privilegio passa pelo admin PS / owner);
--   - REUSAR as fn_acessos_* (RD-26), nao criar caminho paralelo.
--
-- Extensao das 4 funcoes de acessos, generica e narrowing-safe:
--   1) fn_acessos_pode_gerir: OFICINA_DONO passa a poder gerir acessos da SUA empresa.
--   2) fn_acessos_convidar_pessoa / fn_acessos_definir_papel_gestao: aceitam OFICINA_*;
--      ESCALONAMENTO — so owner/PS_ADMIN concede CLIENT_OWNER ou OFICINA_DONO (dono nao cria dono, O3);
--      ESCOPO do dono da oficina — um OFICINA_DONO (que nao e owner/admin) so pode conceder
--      OFICINA_MECANICO (nada de manager/operator/viewer/owner).
--   3) fn_acessos_remover_pessoa: um OFICINA_DONO so pode remover/inativar um OFICINA_MECANICO
--      (nao owner, nao gerente, nao outro dono).
--
-- NOTA (residuo declarado, mesma familia da Fase 3): estas travas sao no corpo da RPC. Sao o
-- enforcement correto para ESTE caminho; a decisao central de acesso continua sendo trabalho da
-- Fase 3 (fn_acesso_efetivo). Aqui reusamos as fn_acessos_* como o SPEC pediu.
-- ============================================================

-- 1) quem pode gerir: + OFICINA_DONO
CREATE OR REPLACE FUNCTION public.fn_acessos_pode_gerir(p_company_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM tenant_user_roles tur
                 WHERE tur.user_id = auth.uid() AND tur.company_id = p_company_id
                   AND tur.role IN ('CLIENT_OWNER','OFICINA_DONO') AND tur.is_active = true)
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role = 'PS_ADMIN');
$function$;

-- 2a) convidar pessoa
CREATE OR REPLACE FUNCTION public.fn_acessos_convidar_pessoa(p_company_id uuid, p_email text, p_nome text DEFAULT NULL::text, p_areas text[] DEFAULT NULL::text[], p_role text DEFAULT 'viewer'::text, p_plantas uuid[] DEFAULT NULL::uuid[], p_horario jsonb DEFAULT NULL::jsonb, p_papel_gestao text DEFAULT 'CLIENT_VIEWER'::text, p_base_url text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(coalesce(p_email,''))); v_role text := lower(btrim(coalesce(p_role,'viewer')));
  v_papel text := upper(btrim(coalesce(p_papel_gestao,'CLIENT_VIEWER'))); v_caller uuid := auth.uid();
  v_caller_owner boolean; v_caller_of_dono boolean; v_uid uuid; v_invite_id uuid; v_code text; v_contratadas text[]; v_bad text[];
  v_link text; v_mail jsonb; v_empresa text;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.'); END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe um e-mail válido.'); END IF;
  IF v_papel NOT IN ('CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER','OFICINA_DONO','OFICINA_MECANICO') THEN v_papel := 'CLIENT_VIEWER'; END IF;
  v_caller_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true)
                 OR EXISTS (SELECT 1 FROM users WHERE id=v_caller AND system_role='PS_ADMIN');
  v_caller_of_dono := (NOT v_caller_owner) AND EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='OFICINA_DONO' AND is_active=true);
  -- escalonamento: so owner/PS_ADMIN concede master (CLIENT_OWNER ou OFICINA_DONO) -> dono nao cria dono
  IF v_papel IN ('CLIENT_OWNER','OFICINA_DONO') AND NOT v_caller_owner THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só um master pode conceder o papel de master.'); END IF;
  -- escopo do dono da oficina: so pode convidar mecanico
  IF v_caller_of_dono AND v_papel <> 'OFICINA_MECANICO' THEN RETURN jsonb_build_object('ok', false, 'erro', 'O dono da oficina só pode convidar mecânico.'); END IF;
  IF v_role IN ('adm','admin','acesso_total','ps_admin','adm_investimentos') OR public.fn_role_to_nivel(v_role)='administrador' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nível não permitido (sem escalação para admin).'); END IF;

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

    v_link := COALESCE(NULLIF(rtrim(p_base_url,'/'),''),'') || '/convite?code=' || v_code;
    SELECT nome_fantasia INTO v_empresa FROM companies WHERE id = p_company_id;
    v_mail := public.fn_enviar_email(v_email, 'convite',
      jsonb_build_object('nome', p_nome, 'empresa', v_empresa, 'link', v_link, 'idempotency_key', v_code, 'company_id', p_company_id));

    RETURN jsonb_build_object('ok', true, 'acao','convidado', 'invite_id', v_invite_id, 'invite_code', v_code,
      'link', '/convite?code='||v_code, 'email_enviado', COALESCE((v_mail->>'ok')::boolean, false), 'email_erro', v_mail->>'erro');
  END IF;
END; $function$;

-- 2b) definir papel de gestao
CREATE OR REPLACE FUNCTION public.fn_acessos_definir_papel_gestao(p_company_id uuid, p_user_id uuid, p_papel text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_papel text := upper(btrim(coalesce(p_papel,'')));
  v_caller uuid := auth.uid();
  v_caller_owner boolean; v_caller_of_dono boolean;
  v_alvo_atual text;
  v_owners_ativos int;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF v_papel NOT IN ('CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER','OFICINA_DONO','OFICINA_MECANICO') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Papel de gestão inválido.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id=p_user_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

  v_caller_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true)
                 OR EXISTS (SELECT 1 FROM users WHERE id=v_caller AND system_role='PS_ADMIN');
  v_caller_of_dono := (NOT v_caller_owner) AND EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='OFICINA_DONO' AND is_active=true);
  -- escalonamento: so owner/PS_ADMIN concede master (CLIENT_OWNER ou OFICINA_DONO)
  IF v_papel IN ('CLIENT_OWNER','OFICINA_DONO') AND NOT v_caller_owner THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só um master pode conceder o papel de master.');
  END IF;
  -- escopo do dono da oficina: so pode conceder mecanico
  IF v_caller_of_dono AND v_papel <> 'OFICINA_MECANICO' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'O dono da oficina só pode definir o papel de mecânico.');
  END IF;

  SELECT role INTO v_alvo_atual FROM tenant_user_roles
   WHERE user_id=p_user_id AND company_id=p_company_id AND is_active=true LIMIT 1;

  IF v_alvo_atual='CLIENT_OWNER' AND v_papel<>'CLIENT_OWNER' THEN
    SELECT count(*) INTO v_owners_ativos FROM tenant_user_roles
     WHERE company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true;
    IF v_owners_ativos <= 1 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Não é possível rebaixar o ÚLTIMO master da empresa. Defina outro master antes.');
    END IF;
  END IF;

  INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by, assigned_at)
  VALUES (p_user_id, p_company_id, v_papel, true, v_caller, now())
  ON CONFLICT (user_id, company_id) DO UPDATE SET role=EXCLUDED.role, is_active=true, assigned_by=v_caller, assigned_at=now();

  INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
  VALUES ('tenant_user_roles','ACESSO_DEFINIR_PAPEL_GESTAO', p_user_id::text,
    jsonb_build_object('company_id',p_company_id,'de',v_alvo_atual,'para',v_papel), v_caller, now());

  RETURN jsonb_build_object('ok', true, 'papel', v_papel);
END;
$function$;

-- 3) remover pessoa: dono da oficina so remove mecanico
CREATE OR REPLACE FUNCTION public.fn_acessos_remover_pessoa(p_company_id uuid, p_user_id uuid, p_modo text DEFAULT 'desvincular'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_modo text := lower(btrim(coalesce(p_modo,'desvincular')));
  v_alvo_owner boolean;
  v_owners_ativos int;
  v_caller_owner boolean; v_caller_of_dono boolean;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF v_modo NOT IN ('desvincular','inativar') THEN v_modo := 'desvincular'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id=p_user_id AND company_id=p_company_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=p_user_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

  -- escopo do dono da oficina: so remove/inativa MECANICO (nao owner, nao gerente, nao outro dono)
  v_caller_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true)
                 OR EXISTS (SELECT 1 FROM users WHERE id=v_caller AND system_role='PS_ADMIN');
  v_caller_of_dono := (NOT v_caller_owner) AND EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='OFICINA_DONO' AND is_active=true);
  IF v_caller_of_dono THEN
    IF NOT EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=p_user_id AND company_id=p_company_id AND role='OFICINA_MECANICO' AND is_active=true) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'O dono da oficina só pode remover mecânico.');
    END IF;
  END IF;

  v_alvo_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=p_user_id AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true);
  IF v_alvo_owner THEN
    SELECT count(*) INTO v_owners_ativos FROM tenant_user_roles
     WHERE company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true;
    IF v_owners_ativos <= 1 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Não é possível remover o ÚLTIMO master da empresa. Defina outro master antes.');
    END IF;
  END IF;

  IF v_modo = 'inativar' THEN
    UPDATE tenant_user_roles SET is_active=false, assigned_by=v_caller, assigned_at=now()
     WHERE user_id=p_user_id AND company_id=p_company_id;
    INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
    VALUES ('tenant_user_roles','ACESSO_INATIVADO', p_user_id::text,
      jsonb_build_object('company_id',p_company_id), v_caller, now());
    RETURN jsonb_build_object('ok', true, 'acao', 'inativado');
  ELSE
    DELETE FROM user_companies WHERE user_id=p_user_id AND company_id=p_company_id;
    UPDATE tenant_user_roles SET is_active=false, assigned_by=v_caller, assigned_at=now()
     WHERE user_id=p_user_id AND company_id=p_company_id;
    DELETE FROM user_plantas WHERE user_id=p_user_id AND company_id=p_company_id;
    INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
    VALUES ('user_companies','ACESSO_DESVINCULADO', p_user_id::text,
      jsonb_build_object('company_id',p_company_id), v_caller, now());
    RETURN jsonb_build_object('ok', true, 'acao', 'desvinculado');
  END IF;
END;
$function$;
