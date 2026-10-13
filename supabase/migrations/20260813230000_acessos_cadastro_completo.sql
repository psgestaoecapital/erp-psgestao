-- RD-41 · Admin/Acessos: cadastro de usuário completo (cargo, telefone, CPF, observação, status).
-- Aditivo (RD-30): novas colunas em users. RD-52: DROP+CREATE da RPC (novos params ao final, 1 assinatura).
-- Campos não apagam com vazio (COALESCE/NULLIF), exceto observação (COALESCE só p/ null). Status = users.is_active
-- (acesso ao sistema, global). O contexto passa a devolver os campos p/ a tela pré-preencher.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cargo text,
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS observacao text;

-- ── Salvar pessoa (estende #989: + cargo/telefone/cpf/observacao/ativo) ───────────────────────────
DROP FUNCTION IF EXISTS public.fn_acessos_salvar_pessoa(uuid, uuid, text[], text, uuid[], jsonb, text);

CREATE OR REPLACE FUNCTION public.fn_acessos_salvar_pessoa(
  p_company_id uuid, p_user_id uuid, p_areas text[], p_role text,
  p_plantas uuid[], p_horario jsonb, p_nome text DEFAULT NULL,
  p_cargo text DEFAULT NULL, p_telefone text DEFAULT NULL, p_cpf text DEFAULT NULL,
  p_observacao text DEFAULT NULL, p_ativo boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role_norm text; v_role_final text; v_contratadas text[]; v_bad text[]; v_bad_plant int; v_persist text[];
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = p_user_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

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

  -- Dados cadastrais (não apagam com vazio, exceto observação que aceita ''; status = is_active global)
  UPDATE public.users SET
    full_name  = COALESCE(NULLIF(btrim(COALESCE(p_nome,'')),''), full_name),
    cargo      = COALESCE(NULLIF(btrim(COALESCE(p_cargo,'')),''), cargo),
    telefone   = COALESCE(NULLIF(btrim(COALESCE(p_telefone,'')),''), telefone),
    cpf        = COALESCE(NULLIF(regexp_replace(COALESCE(p_cpf,''), '\D', '', 'g'),''), cpf),
    observacao = COALESCE(p_observacao, observacao),
    is_active  = COALESCE(p_ativo, is_active),
    updated_at = now()
  WHERE id = p_user_id;

  PERFORM public.fn_provisionar_user_scope(p_user_id, p_company_id, v_role_final, p_areas);

  SELECT areas_allowed INTO v_persist FROM user_areas_allowed WHERE user_id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'role', v_role_final, 'areas', to_jsonb(COALESCE(v_persist, p_areas)));
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_acessos_salvar_pessoa(uuid, uuid, text[], text, uuid[], jsonb, text, text, text, text, text, boolean) TO authenticated;

-- ── Contexto: devolve os novos campos por pessoa (p/ a tela pré-preencher) ─────────────────────────
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
          'cargo', u.cargo, 'telefone', u.telefone, 'cpf', u.cpf, 'observacao', u.observacao, 'is_active', u.is_active,
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
