-- Acessos · cadastro do vendedor grava PAPEL + CÓDIGO no MESMO salvar (raiz do "menu aberto", spec do CEO 26/11).
--
-- Problema: fn_acessos_salvar_pessoa não gravava user_scope.papel_slug. A tela chamava fn_acessos_definir_papel_rbac
-- numa SEGUNDA chamada (e o código do vendedor numa terceira, em outra tela). Quando a 2ª/3ª não acontecia, o vendedor
-- ficava sem papel → fn_modulos_sidebar_por_area não filtra (RD-97) → menu inteiro aberto.
--
-- Fix (sem recriar backend — REUSA as RPCs com guarda que já existem):
--  1. fn_acessos_salvar_pessoa ganha p_papel_slug (opcional) e p_vendedor_codigo (opcional).
--     · p_papel_slug OMITIDO  → não mexe no papel (compatibilidade com quem não manda o parâmetro).
--     · p_papel_slug NULL/''  → limpa o papel (o nível manda), igual ao fn_acessos_definir_papel_rbac.
--     · p_papel_slug 'slug'   → aplica por fn_acessos_definir_papel_rbac (slug ativo + vertical contratada; a função
--       só é executável por quem gere a empresa — CLIENT_OWNER/PS_ADMIN — e o nível admin continua barrado acima).
--     · p_vendedor_codigo     → liga o usuário ao código do ERP de origem por fn_com_vendedor_acesso_salvar
--       (código tem de existir na equipe; unique (company_id,user_id), upsert; o código fica com um único usuário).
--     · papel 'industria_comercial' (Vendedor Comercial) SEM código informado e sem código ativo → recusa.
--     Qualquer recusa das RPCs reusadas DESFAZ o salvar inteiro (RAISE → transação), nunca fica meio gravado.
--  2. Assinatura nova = DROP da antiga + CREATE (evita sobrecarga ambígua no PostgREST). Grants iguais aos de antes.
--
-- Não altera dado de cliente nesta migration. Backfill (spec item 4): só listagem, feita na PR (RD-38).

DROP FUNCTION IF EXISTS public.fn_acessos_salvar_pessoa(uuid, uuid, text[], text, uuid[], jsonb, text, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.fn_acessos_salvar_pessoa(
  p_company_id uuid, p_user_id uuid, p_areas text[], p_role text, p_plantas uuid[], p_horario jsonb,
  p_nome text DEFAULT NULL::text, p_cargo text DEFAULT NULL::text, p_telefone text DEFAULT NULL::text,
  p_cpf text DEFAULT NULL::text, p_observacao text DEFAULT NULL::text, p_ativo boolean DEFAULT NULL::boolean,
  p_papel_slug text DEFAULT '<manter>'::text,
  p_vendedor_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role_norm text; v_role_final text; v_contratadas text[]; v_bad text[]; v_bad_plant int; v_persist text[];
        -- '<manter>' = parâmetro não enviado (o PostgREST não distingue "omitido" de null): não mexe no papel.
        v_mexe_papel boolean := p_papel_slug IS DISTINCT FROM '<manter>';
        v_slug text := NULLIF(btrim(COALESCE(NULLIF(p_papel_slug, '<manter>'), '')), '');
        v_cod  text := NULLIF(btrim(COALESCE(p_vendedor_codigo, '')), '');
        v_r jsonb; v_papel_final text; v_cod_final text;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = p_user_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;

  -- Vendedor Comercial precisa do código do ERP de origem (senão o painel não sabe qual carteira mostrar).
  IF v_mexe_papel AND v_slug = 'industria_comercial' AND v_cod IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.com_vendedor_acesso a
                     WHERE a.company_id = p_company_id AND a.user_id = p_user_id AND a.ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o código do vendedor: sem ele o painel não sabe qual carteira mostrar.');
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

  -- Papel na empresa (função real) → user_scope.papel_slug, pela MESMA RPC com guarda (slug ativo + vertical contratada).
  -- Vai depois do provisionar (que cria/atualiza o user_scope). Recusa = desfaz o salvar inteiro.
  IF v_mexe_papel THEN
    v_r := public.fn_acessos_definir_papel_rbac(p_company_id, p_user_id, v_slug, NULL);
    IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_r->>'erro', 'Não foi possível aplicar a função (papel).') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Código do vendedor (ERP de origem) → com_vendedor_acesso, pela RPC com guarda (código existe na equipe; upsert por
  -- (company_id,user_id); o código fica com um único usuário). Recusa = desfaz o salvar inteiro.
  IF v_cod IS NOT NULL THEN
    v_r := public.fn_com_vendedor_acesso_salvar(p_company_id, v_cod, p_user_id);
    IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%', CASE v_r->>'erro'
        WHEN 'codigo_inexistente' THEN 'Esse código de vendedor não está na equipe que vem do ERP de origem.'
        WHEN 'usuario_fora_da_empresa' THEN 'Usuário não pertence a esta empresa.'
        ELSE 'Não foi possível gravar o código do vendedor.' END USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT areas_allowed INTO v_persist FROM user_areas_allowed WHERE user_id = p_user_id;
  SELECT s.papel_slug INTO v_papel_final FROM public.user_scope s WHERE s.user_id = p_user_id AND s.company_id = p_company_id;
  SELECT a.codigo INTO v_cod_final FROM public.com_vendedor_acesso a
   WHERE a.company_id = p_company_id AND a.user_id = p_user_id AND a.ativo;
  RETURN jsonb_build_object('ok', true, 'role', v_role_final, 'areas', to_jsonb(COALESCE(v_persist, p_areas)),
    'papel_slug', v_papel_final, 'vendedor_codigo', v_cod_final);
END $function$;

REVOKE ALL ON FUNCTION public.fn_acessos_salvar_pessoa(uuid, uuid, text[], text, uuid[], jsonb, text, text, text, text, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_acessos_salvar_pessoa(uuid, uuid, text[], text, uuid[], jsonb, text, text, text, text, text, boolean, text, text) TO authenticated, service_role;

-- "?" do campo novo na tela de Acessos (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('acessos.vendedor_codigo', 'pessoa', 'Código do vendedor',
  'Escolha o código desta pessoa no ERP de origem. Aparece e é obrigatório quando o papel é Vendedor Comercial.',
  'Liga a pessoa à carteira dela: o painel de vendas mostra só os clientes e pedidos deste código. Papel e código são gravados juntos no Salvar.',
  '80013 · Vendedor · superior 86062.',
  'Salvar Vendedor Comercial sem código: o painel fica vazio. Escolher o código de outra pessoa: ela passa a ver a carteira errada.',
  13, '/dashboard/admin/acessos', NULL, 'publicado')
ON CONFLICT (chave) DO NOTHING;
