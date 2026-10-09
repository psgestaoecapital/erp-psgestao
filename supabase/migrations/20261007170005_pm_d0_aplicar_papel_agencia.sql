-- ============================================================
-- P&M D0 · "Papel na agência": prévia (antes/depois) e aplicação do papel da vertical 'pm' a uma pessoa.
-- Prova (RD-38, 07/10): o papel da vertical vive em user_scope.papel_slug (FK rbac_papel) e só é lido por
-- fn_acesso_efetivo (campos 'acessos'/'decidido'); nenhum consumidor (front/RLS) usa isso ainda -> gravar o papel
-- NÃO retira nem concede tela hoje. Teto = user_scope.nivel (acessos = MENOR entre papel e teto).
-- Armadilha: user_scope.org_unidade_id é NOT NULL e a Pdois tem 0 org_unidade -> a ação cria o nó raiz
-- ('empresa') se a empresa não tem nenhum. O upsert NÃO toca dominios/org de linha existente (escopo de DADOS).
-- Nada aqui aplica papel a ninguém: só cria as duas funções. Quem aplica é o CEO, pela tela.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_pm_papel_agencia_previa(p_company uuid, p_user uuid, p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_teto text; v_acessos jsonb; v_tem_scope boolean; v_tem_org boolean; v_nivel_atual text;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = p_user AND company_id = p_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Usuário não pertence a esta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rbac_papel WHERE slug = p_slug AND vertical = 'pm' AND slug <> 'pm_cliente') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Papel inválido para a agência.');
  END IF;
  SELECT (ARRAY['ver','filtrar','editar','aprovar'])[max(array_position(ARRAY['ver','filtrar','editar','aprovar'], nivel))],
         COALESCE(jsonb_object_agg(subgrupo, nivel), '{}'::jsonb)
    INTO v_teto, v_acessos FROM rbac_papel_acesso WHERE papel_slug = p_slug;
  SELECT true, nivel INTO v_tem_scope, v_nivel_atual FROM user_scope WHERE user_id = p_user AND company_id = p_company;
  SELECT EXISTS (SELECT 1 FROM org_unidade WHERE company_id = p_company) INTO v_tem_org;
  RETURN jsonb_build_object('ok', true,
    'antes', public.fn_acesso_efetivo(p_user, p_company),
    'depois', jsonb_build_object('papel_slug', p_slug, 'teto', COALESCE(v_nivel_atual, v_teto), 'acessos_do_papel', v_acessos),
    'cria_linha_escopo', COALESCE(v_tem_scope, false) = false,
    'cria_no_raiz', NOT v_tem_org,
    'efeito_nas_telas_hoje', 'nenhum: só fn_acesso_efetivo lê o papel; menus e RLS seguem o papel de gestão atual');
END $$;

CREATE OR REPLACE FUNCTION public.fn_pm_papel_agencia_aplicar(p_company uuid, p_user uuid, p_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prev jsonb; v_antes jsonb; v_org uuid; v_nome text; v_teto text;
BEGIN
  v_prev := public.fn_pm_papel_agencia_previa(p_company, p_user, p_slug);
  IF NOT COALESCE((v_prev->>'ok')::boolean, false) THEN RETURN v_prev; END IF;
  v_antes := v_prev->'antes';

  SELECT nome INTO v_nome FROM rbac_papel WHERE slug = p_slug;
  v_teto := v_prev->'depois'->>'teto';

  SELECT org_unidade_id INTO v_org FROM user_scope WHERE user_id = p_user AND company_id = p_company;
  IF v_org IS NULL THEN
    SELECT id INTO v_org FROM org_unidade WHERE company_id = p_company AND ativo
      ORDER BY (parent_id IS NULL) DESC, ordem, criado_em LIMIT 1;
  END IF;
  IF v_org IS NULL THEN
    INSERT INTO org_unidade (company_id, tipo, nome, ordem) VALUES (p_company, 'empresa', 'Agência', 0) RETURNING id INTO v_org;
  END IF;

  INSERT INTO user_scope (user_id, company_id, org_unidade_id, nivel, papel_rotulo, dominios, ativo, papel_slug, observacao)
  VALUES (p_user, p_company, v_org, v_teto, v_nome, '{}'::text[], true, p_slug,
          'D0 papel na agência · aplicado por ' || COALESCE(auth.uid()::text, 'sistema') || ' em ' || to_char(now(), 'YYYY-MM-DD HH24:MI'))
  ON CONFLICT (user_id, company_id) DO UPDATE
    SET papel_slug = EXCLUDED.papel_slug,
        observacao = COALESCE(user_scope.observacao || ' | ', '') || EXCLUDED.observacao;

  RETURN jsonb_build_object('ok', true, 'antes', v_antes, 'depois', public.fn_acesso_efetivo(p_user, p_company));
END $$;

REVOKE ALL ON FUNCTION public.fn_pm_papel_agencia_previa(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_papel_agencia_aplicar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_papel_agencia_previa(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_papel_agencia_aplicar(uuid, uuid, text) TO authenticated;
