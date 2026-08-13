-- RD-41 · Acessos: permitir editar o NOME da pessoa (users.full_name) pela tela de Acessos.
-- A RPC fn_acessos_salvar_pessoa não recebia o nome → impossível editar. Adiciona p_nome ao final.
-- RD-52: adicionar um parâmetro DEFAULT criaria overload ambíguo p/ chamadas de 6 args → DROP + CREATE.
DROP FUNCTION IF EXISTS public.fn_acessos_salvar_pessoa(uuid, uuid, text[], text, uuid[], jsonb);

CREATE OR REPLACE FUNCTION public.fn_acessos_salvar_pessoa(
  p_company_id uuid, p_user_id uuid, p_areas text[], p_role text,
  p_plantas uuid[], p_horario jsonb, p_nome text DEFAULT NULL)
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

  -- NOVO: grava o nome, só se veio preenchido (não apaga o existente com vazio · RD-51)
  IF NULLIF(btrim(COALESCE(p_nome, '')), '') IS NOT NULL THEN
    UPDATE public.users SET full_name = btrim(p_nome), updated_at = now() WHERE id = p_user_id;
  END IF;

  PERFORM public.fn_provisionar_user_scope(p_user_id, p_company_id, v_role_final, p_areas);

  SELECT areas_allowed INTO v_persist FROM user_areas_allowed WHERE user_id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'role', v_role_final, 'areas', to_jsonb(COALESCE(v_persist, p_areas)));
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_acessos_salvar_pessoa(uuid, uuid, text[], text, uuid[], jsonb, text) TO authenticated;
