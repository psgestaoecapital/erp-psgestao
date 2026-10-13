-- RBAC: dono de empresa DERIVA das assinaturas, não congela na foto do convite (RD-56 / RD-58).
--
-- Achado (o CEO pegou no dado, a partir do Fábio/Alliance): quem é convidado como CLIENT_OWNER recebia
-- areas_allowed = TODAS as áreas habilitadas NAQUELE momento, com restricted=true. Quando a empresa
-- contrata uma vertical nova (ex.: Revenda), o dono já convidado NÃO é atualizado — vê o que existia no
-- dia do convite. Mesmo padrão do catalogo[0] e do modelo de IA fixo: dado que envelhece sem avisar.
--
-- Decisão (CEO): Opção A — dono não é restricted; deriva das assinaturas ao vivo. fn_listar_areas_visiveis
-- já gateia por vertical contratada POR EMPRESA, então dono sem restrição vê exatamente o que cada empresa
-- dele contratou, sempre atual (resolve inclusive o multi-empresa que uma lista global nunca acerta).
-- Restrição de OPERADOR/VIEWER é decisão (escopo explícito) e fica intacta; restrição de DONO é acidente.
-- Usuário de nível PS (system_role PS_ADMIN/PS_SUPPORT) NÃO entra nesta derivação — regra deles é outra.

-- (1) ORIGEM: dono nasce SEM restrição. Só o ramo de convite com áreas explícitas (escopo intencional)
--     cria linha restrita; o ramo CLIENT_OWNER grava restricted=false (deriva das assinaturas).
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
  v_restringir boolean := true;  -- default seguro; o ramo de dono zera (deriva das assinaturas)
BEGIN
  SELECT * INTO inv FROM invites WHERE id = p_invite_id;
  IF inv.id IS NULL OR inv.used_by IS NULL OR inv.company_id IS NULL THEN RETURN; END IF;

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

  v_client_role := COALESCE(NULLIF(inv.client_role,''), public.fn_map_invite_role_to_client_role(inv.role));
  INSERT INTO tenant_user_roles (user_id, company_id, role, is_active, assigned_by, assigned_at, observacao)
  VALUES (inv.used_by, inv.company_id, v_client_role, true, inv.created_by, now(), 'Convite '||inv.invite_code)
  ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role, is_active = true;

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

  IF inv.areas_liberadas IS NOT NULL AND array_length(inv.areas_liberadas,1) > 0 THEN
    -- Convite com áreas explícitas = escopo INTENCIONAL → mantém restrição.
    v_restringir := true;
    SELECT array_agg(s.area_slug) INTO v_areas
    FROM fn_empresa_areas_status(inv.company_id) s
    WHERE s.habilitada AND s.area_slug = ANY(inv.areas_liberadas);
  ELSIF v_client_role = 'CLIENT_OWNER' THEN
    -- DONO: deriva das assinaturas → NASCE SEM restrição (restricted=false). areas_allowed guardado só
    -- como informativo (ignorado quando restricted=false); assim, contratar vertical nova aparece sozinho.
    v_restringir := false;
    SELECT array_agg(s.area_slug) INTO v_areas
    FROM fn_empresa_areas_status(inv.company_id) s WHERE s.habilitada;
  END IF;

  IF v_areas IS NOT NULL AND array_length(v_areas,1) > 0 THEN
    INSERT INTO user_areas_allowed (user_id, areas_allowed, restricted, motivo, granted_by, granted_at)
    VALUES (inv.used_by, v_areas, v_restringir, 'Provisionado via convite', inv.created_by, now())
    ON CONFLICT (user_id) DO UPDATE
      SET areas_allowed = EXCLUDED.areas_allowed, restricted = EXCLUDED.restricted,
          motivo = EXCLUDED.motivo, granted_by = EXCLUDED.granted_by, updated_at = now();
  END IF;

  IF inv.plantas IS NOT NULL AND array_length(inv.plantas,1) > 0 THEN
    DELETE FROM user_plantas WHERE user_id = inv.used_by AND company_id = inv.company_id;
    INSERT INTO user_plantas (user_id, plant_id, company_id)
    SELECT inv.used_by, pid, inv.company_id
    FROM unnest(inv.plantas) pid
    WHERE EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = pid AND ip.company_id = inv.company_id)
    ON CONFLICT (user_id, plant_id) DO NOTHING;
  END IF;

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
    jsonb_build_object('user_id',inv.used_by,'company_id',inv.company_id,'invite_role',inv.role,'client_role',v_client_role,'areas',v_areas,'restringir',v_restringir),
    inv.created_by, now());
END;
$function$;

-- (2) BACKFILL dos donos já congelados: zera restricted SÓ de CLIENT_OWNER que NÃO é PS-level.
--     Idempotente (re-rodar não muda quem já está restricted=false). Operador/viewer/manager NÃO tocados.
--     O CEO revê a lista no PR ANTES do merge; roda no merge (deploy-migrations).
UPDATE public.user_areas_allowed uaa
   SET restricted = false, updated_at = now()
 WHERE uaa.restricted = true
   AND EXISTS (
     SELECT 1 FROM public.tenant_user_roles tur
     WHERE tur.user_id = uaa.user_id AND tur.is_active AND tur.role = 'CLIENT_OWNER')
   AND NOT EXISTS (
     SELECT 1 FROM public.users u
     WHERE u.id = uaa.user_id AND u.system_role IN ('PS_ADMIN','PS_SUPPORT'));
