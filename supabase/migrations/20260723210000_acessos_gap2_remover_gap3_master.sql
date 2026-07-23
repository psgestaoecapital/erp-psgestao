-- PARTE B · GAP 2 (excluir/desvincular) + GAP 3 (trocar papel de gestão / master).
-- Genérico p/ qualquer empresa. Guards RD-25. NUNCA hard-delete de users. NUNCA zerar o último master.

-- GAP 3 · define o PAPEL DE GESTÃO (o que a pessoa PODE GERIR) — distinto do nível (o que VÊ).
CREATE OR REPLACE FUNCTION public.fn_acessos_definir_papel_gestao(
  p_company_id uuid, p_user_id uuid, p_papel text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_papel text := upper(btrim(coalesce(p_papel,'')));
  v_caller uuid := auth.uid();
  v_caller_owner boolean;
  v_alvo_atual text;
  v_owners_ativos int;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF v_papel NOT IN ('CLIENT_OWNER','CLIENT_MANAGER','CLIENT_OPERATOR','CLIENT_VIEWER') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Papel de gestão inválido.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id=p_user_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

  v_caller_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=v_caller AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true)
                 OR EXISTS (SELECT 1 FROM users WHERE id=v_caller AND system_role='PS_ADMIN');
  IF v_papel='CLIENT_OWNER' AND NOT v_caller_owner THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só um master pode conceder o papel de master.');
  END IF;

  SELECT role INTO v_alvo_atual FROM tenant_user_roles
   WHERE user_id=p_user_id AND company_id=p_company_id AND is_active=true LIMIT 1;

  -- NUNCA deixar a empresa sem master (bloqueia rebaixar/auto-rebaixar o último owner)
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

REVOKE ALL ON FUNCTION public.fn_acessos_definir_papel_gestao(uuid,uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_acessos_definir_papel_gestao(uuid,uuid,text) TO authenticated;

-- GAP 2 · remover pessoa (desvincular da empresa OU inativar) — NUNCA hard-delete de users.
CREATE OR REPLACE FUNCTION public.fn_acessos_remover_pessoa(
  p_company_id uuid, p_user_id uuid, p_modo text DEFAULT 'desvincular'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_modo text := lower(btrim(coalesce(p_modo,'desvincular')));
  v_alvo_owner boolean;
  v_owners_ativos int;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF v_modo NOT IN ('desvincular','inativar') THEN v_modo := 'desvincular'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id=p_user_id AND company_id=p_company_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=p_user_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

  -- NUNCA remover o último master
  v_alvo_owner := EXISTS (SELECT 1 FROM tenant_user_roles WHERE user_id=p_user_id AND company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true);
  IF v_alvo_owner THEN
    SELECT count(*) INTO v_owners_ativos FROM tenant_user_roles
     WHERE company_id=p_company_id AND role='CLIENT_OWNER' AND is_active=true;
    IF v_owners_ativos <= 1 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Não é possível remover o ÚLTIMO master da empresa. Defina outro master antes.');
    END IF;
  END IF;

  IF v_modo = 'inativar' THEN
    -- mantém o vínculo (histórico), só desativa o papel de gestão
    UPDATE tenant_user_roles SET is_active=false, assigned_by=v_caller, assigned_at=now()
     WHERE user_id=p_user_id AND company_id=p_company_id;
    INSERT INTO audit_log_global (tabela, acao, registro_id, valor_novo, user_id, created_at)
    VALUES ('tenant_user_roles','ACESSO_INATIVADO', p_user_id::text,
      jsonb_build_object('company_id',p_company_id), v_caller, now());
    RETURN jsonb_build_object('ok', true, 'acao', 'inativado');
  ELSE
    -- desvincular: tira da empresa (user_companies) + desativa papel + limpa plantas dessa empresa.
    -- NÃO mexe em user_areas_allowed (é global por usuário — apagar tiraria acesso em OUTRAS empresas).
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

REVOKE ALL ON FUNCTION public.fn_acessos_remover_pessoa(uuid,uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_acessos_remover_pessoa(uuid,uuid,text) TO authenticated;

-- GAP 3 (UI) · contexto passa a devolver o papel_gestao real por pessoa (não só is_master).
CREATE OR REPLACE FUNCTION public.fn_acessos_empresa_contexto(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerir acessos desta empresa';
  END IF;

  SELECT jsonb_build_object(
    'empresa', (SELECT jsonb_build_object('id', c.id, 'nome_fantasia', c.nome_fantasia, 'razao_social', c.razao_social)
                FROM companies c WHERE c.id = p_company_id),
    'areas_contratadas', COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', s.area_slug, 'nome', s.nome_menu) ORDER BY s.ordem)
                FROM fn_empresa_areas_status(p_company_id) s WHERE s.habilitada), '[]'::jsonb),
    'plantas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ip.id, 'nome', ip.nome_planta) ORDER BY ip.nome_planta)
                FROM industrial_plants ip WHERE ip.company_id = p_company_id AND ip.is_active), '[]'::jsonb),
    'master', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', tur.user_id, 'email', u.email, 'nome', u.full_name))
                FROM tenant_user_roles tur JOIN users u ON u.id = tur.user_id
                WHERE tur.company_id = p_company_id AND tur.role = 'CLIENT_OWNER' AND tur.is_active = true), '[]'::jsonb),
    'pessoas', COALESCE((SELECT jsonb_agg(p ORDER BY p->>'email') FROM (
        SELECT jsonb_build_object(
          'user_id', u.id, 'email', u.email, 'nome', u.full_name, 'role', u.role,
          'nivel', public.fn_role_to_nivel(u.role),
          'is_master', EXISTS (SELECT 1 FROM tenant_user_roles t2 WHERE t2.user_id = u.id AND t2.company_id = p_company_id AND t2.role = 'CLIENT_OWNER' AND t2.is_active = true),
          'papel_gestao', (SELECT t3.role FROM tenant_user_roles t3 WHERE t3.user_id = u.id AND t3.company_id = p_company_id AND t3.is_active = true LIMIT 1),
          'restricted', COALESCE(uaa.restricted, false),
          'areas', CASE WHEN uaa.restricted THEN to_jsonb(uaa.areas_allowed) ELSE NULL END,
          'plantas', COALESCE((SELECT jsonb_agg(up.plant_id) FROM user_plantas up WHERE up.user_id = u.id AND up.company_id = p_company_id), '[]'::jsonb),
          'horario', (SELECT jsonb_build_object('dias_semana', to_jsonb(h.dias_semana), 'hora_inicio', h.hora_inicio, 'hora_fim', h.hora_fim, 'timezone', h.timezone, 'ativo', h.ativo)
                      FROM user_horario_acesso h WHERE h.user_id = u.id AND h.company_id = p_company_id),
          'ultimo_login', au.last_sign_in_at,
          'situacao', CASE WHEN au.last_sign_in_at IS NULL THEN 'NUNCA_LOGOU'
                           WHEN au.last_sign_in_at < now() - interval '30 days' THEN 'INATIVO_30DIAS'
                           WHEN au.last_sign_in_at < now() - interval '7 days' THEN 'INATIVO_7DIAS'
                           ELSE 'ATIVO' END
        ) AS p
        FROM user_companies uc
        JOIN users u ON u.id = uc.user_id
        LEFT JOIN auth.users au ON au.id = u.id
        LEFT JOIN user_areas_allowed uaa ON uaa.user_id = u.id
        WHERE uc.company_id = p_company_id
    ) x), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $function$;
