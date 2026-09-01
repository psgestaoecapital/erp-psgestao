-- RBAC Fase 0 · Bloco C — declarar a relação grupo × domínio e fechar os dois desvios.
-- user_scope.dominios[] opera em nível de GRUPO (é o que area_menu_config vende). Hoje isso é
-- convenção implícita: nada garante que o valor gravado seja um grupo real. 'gente' e 'sst' estão
-- em uso mas NÃO são grupos; um typo ('industral') gravaria em silêncio e tiraria acesso sem erro.
--
-- Correção mínima (NÃO usar CHECK estático — grupo novo quebraria a tabela): função de validação
-- contra module_catalog (a fonte viva), chamada em TODOS os caminhos de escrita (RD-57 — trava na raiz).
-- Decisão do CEO: 'gente'→'industrial', 'sst'→'compliance' (traduzir, não criar vertical fantasma);
-- guardar o valor antigo em user_scope.observacao antes de sobrescrever (reconstituível).

-- 1) Validador: devolve os domínios INVÁLIDOS ('{}' = todos válidos). Válido = 'TODOS' ou grupo vivo.
CREATE OR REPLACE FUNCTION public.fn_validar_dominios(p_dominios text[])
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(array_agg(d), '{}'::text[])
  FROM unnest(COALESCE(p_dominios, '{}'::text[])) d
  WHERE d <> 'TODOS'
    AND d NOT IN (SELECT DISTINCT grupo FROM public.module_catalog WHERE grupo IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public.fn_validar_dominios(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_validar_dominios(text[]) TO authenticated, service_role;

-- 2) Tradução (fix de dado, uma vez). Guarda o antigo em observacao ANTES de sobrescrever.
UPDATE public.user_scope
SET observacao = COALESCE(NULLIF(btrim(COALESCE(observacao,'')),'') || ' | ', '')
               || 'RBAC-F0 dominios anteriores: ' || array_to_string(dominios, ','),
    dominios = ARRAY(
      SELECT DISTINCT CASE d WHEN 'gente' THEN 'industrial' WHEN 'sst' THEN 'compliance' ELSE d END
      FROM unnest(dominios) d
    )
WHERE dominios && ARRAY['gente','sst'];

-- 3) Trava na escrita — caminho direto 1: fn_owner_scope_conceder (grava p_dominios).
CREATE OR REPLACE FUNCTION public.fn_owner_scope_conceder(p_company_id uuid, p_user_id uuid, p_unidade_ids uuid[], p_dominios text[], p_nivel text, p_papel_rotulo text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_email text; v_n int := 0; v_scope_id uuid;
BEGIN
  IF NOT public.fn_owner_pode_gerir_escopo(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id=p_user_id AND company_id=p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta pessoa não faz parte da empresa.');
  END IF;
  IF p_unidade_ids IS NULL OR cardinality(p_unidade_ids)=0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Selecione ao menos um setor.');
  END IF;
  IF p_dominios IS NULL OR cardinality(p_dominios)=0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Selecione ao menos um tipo de dado.');
  END IF;
  -- RBAC F0: domínio inválido não é gravável (valida contra grupos vivos)
  IF cardinality(public.fn_validar_dominios(p_dominios)) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Domínio(s) inválido(s): '||array_to_string(public.fn_validar_dominios(p_dominios), ', '));
  END IF;
  IF coalesce(p_nivel,'') NOT IN ('ver','editar') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nível inválido.');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_unidade_ids) x(id)
             WHERE NOT EXISTS (SELECT 1 FROM org_unidade o WHERE o.id=x.id AND o.company_id=p_company_id)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Setor fora da empresa — bloqueado.');
  END IF;

  v_uid := auth.uid();
  SELECT email INTO v_email FROM users WHERE id=v_uid;

  FOREACH v_scope_id IN ARRAY p_unidade_ids LOOP
    IF EXISTS (SELECT 1 FROM user_scope WHERE user_id=p_user_id AND company_id=p_company_id AND org_unidade_id=v_scope_id) THEN
      UPDATE user_scope SET dominios=p_dominios, nivel=p_nivel, ativo=true,
             papel_rotulo=COALESCE(p_papel_rotulo, papel_rotulo)
       WHERE user_id=p_user_id AND company_id=p_company_id AND org_unidade_id=v_scope_id;
    ELSE
      INSERT INTO user_scope (user_id, company_id, org_unidade_id, dominios, nivel, papel_rotulo, observacao)
      VALUES (p_user_id, p_company_id, v_scope_id, p_dominios, p_nivel, p_papel_rotulo,
              'Concedido pela tela do dono por '||coalesce(v_email,'?'));
    END IF;
    v_n := v_n + 1;
  END LOOP;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, v_uid, v_email, 'user_scope', p_user_id::text, 'ESCOPO_CONCEDIDO',
          jsonb_build_object('unidades', p_unidade_ids, 'dominios', p_dominios, 'nivel', p_nivel));

  RETURN jsonb_build_object('ok', true, 'unidades', v_n);
END $function$;

-- 4) Trava na escrita — caminho direto 2 (e backstop de fn_acessos_salvar_pessoa, que passa por aqui):
--    fn_provisionar_user_scope (grava o dominios computado). void → RAISE em inválido.
CREATE OR REPLACE FUNCTION public.fn_provisionar_user_scope(p_user uuid, p_company uuid, p_role text, p_areas text[] DEFAULT NULL::text[], p_nivel text DEFAULT NULL::text, p_papel_rotulo text DEFAULT NULL::text, p_org_unidade uuid DEFAULT NULL::uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rotulo text; v_dominios text[]; v_org uuid; v_nivel text;
        v_peer public.user_scope%rowtype;
BEGIN
  SELECT s.* INTO v_peer
  FROM public.user_scope s JOIN public.users u2 ON u2.id = s.user_id
  WHERE s.company_id = p_company AND lower(coalesce(u2.role,'')) = lower(coalesce(p_role,''))
    AND s.user_id <> p_user AND s.ativo
  ORDER BY s.criado_em LIMIT 1;

  v_org := COALESCE(
    p_org_unidade, v_peer.org_unidade_id,
    (SELECT s.org_unidade_id FROM public.user_scope s WHERE s.company_id = p_company AND s.org_unidade_id IS NOT NULL
       GROUP BY s.org_unidade_id ORDER BY count(*) DESC LIMIT 1),
    (SELECT o.id FROM public.org_unidade o WHERE o.company_id = p_company AND o.ativo AND o.parent_id IS NOT NULL
       ORDER BY o.ordem NULLS LAST, o.criado_em LIMIT 1),
    (SELECT o.id FROM public.org_unidade o WHERE o.company_id = p_company AND o.ativo
       ORDER BY o.ordem NULLS LAST, o.criado_em LIMIT 1)
  );
  IF v_org IS NULL THEN RETURN; END IF;

  v_nivel  := COALESCE(NULLIF(btrim(coalesce(p_nivel,'')),''), v_peer.nivel, 'ver');
  v_rotulo := COALESCE(NULLIF(btrim(coalesce(p_papel_rotulo,'')),''), v_peer.papel_rotulo, CASE lower(coalesce(p_role,''))
    WHEN 'rh_industrial'    THEN 'RH'
    WHEN 'sst'              THEN 'Técnico Seg. Trabalho'
    WHEN 'gerente_planta'   THEN 'Gerente de Planta'
    WHEN 'gerente_processo' THEN 'Gerente de Processo'
    WHEN 'supervisor_turno' THEN 'Supervisor de Turno'
    WHEN 'operador'         THEN 'Operador'
    WHEN 'diretor_area'     THEN 'Diretor de Área'
    WHEN 'operacional'      THEN 'Operacional'
    ELSE initcap(replace(coalesce(NULLIF(p_role,''),'—'),'_',' ')) END);
  v_dominios := COALESCE(p_areas, v_peer.dominios, (SELECT areas_allowed FROM public.user_areas_allowed WHERE user_id = p_user));

  -- RBAC F0: nunca gravar domínio inválido em user_scope (backstop de todos os caminhos, RD-57).
  IF cardinality(public.fn_validar_dominios(v_dominios)) > 0 THEN
    RAISE EXCEPTION 'Domínio(s) inválido(s) em user_scope: %', array_to_string(public.fn_validar_dominios(v_dominios), ', ');
  END IF;

  INSERT INTO public.user_scope (user_id, company_id, org_unidade_id, nivel, papel_rotulo, dominios, ativo, criado_em)
  VALUES (p_user, p_company, v_org, v_nivel, v_rotulo, COALESCE(v_dominios, '{}'::text[]), true, now())
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET org_unidade_id = EXCLUDED.org_unidade_id, nivel = EXCLUDED.nivel,
        papel_rotulo = EXCLUDED.papel_rotulo, dominios = EXCLUDED.dominios, ativo = true;
END $function$;
