-- TELA DO DONO · "Acessos → Escopo de dados": o CLIENT_OWNER concede a alguém da SUA empresa
-- quais setores/planta a pessoa pode ver e de quais dados (jornada/ponto, SST, tudo), em VER ou EDITAR.
-- Guardas: só CLIENT_OWNER (ou PS_ADMIN) · sempre escopado à própria empresa · aditivo (soft revoke) ·
-- trilha em audit_log_global de quem concedeu o quê e quando · nunca concede fora da empresa do dono.
-- RPCs dormentes: não mudam dado nenhum até a UI chamar. Linguagem do usuário fica na UI (não aqui).
-- Provado (transação abortada, autenticado via request.jwt.claims, nunca service_role):
--   dono=true · não-dono=false · conceder-fora-da-empresa BLOQUEADO · conceder→passa a ver→revogar(ativo=false).
-- Reverter: DROP das 6 funções abaixo (nenhuma tabela criada; user_scope já existia).

-- 0 · guarda: o chamador pode gerir escopo desta empresa?
CREATE OR REPLACE FUNCTION public.fn_owner_pode_gerir_escopo(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role = 'PS_ADMIN')
      OR EXISTS (SELECT 1 FROM public.tenant_user_roles t
                 WHERE t.user_id = auth.uid() AND t.company_id = p_company_id
                   AND t.role = 'CLIENT_OWNER' AND t.is_active);
$$;
GRANT EXECUTE ON FUNCTION public.fn_owner_pode_gerir_escopo(uuid) TO authenticated;

-- 1 · membros da empresa (picker "quem") + resumo do escopo atual em linguagem simples.
CREATE OR REPLACE FUNCTION public.fn_owner_scope_membros(p_company_id uuid)
RETURNS TABLE(user_id uuid, email text, full_name text, is_owner boolean, resumo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.fn_owner_pode_gerir_escopo(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerir acessos desta empresa.';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email, u.full_name,
         EXISTS(SELECT 1 FROM tenant_user_roles t WHERE t.user_id=u.id AND t.company_id=p_company_id
                  AND t.role='CLIENT_OWNER' AND t.is_active) AS is_owner,
         CASE
           WHEN EXISTS(SELECT 1 FROM tenant_user_roles t WHERE t.user_id=u.id AND t.company_id=p_company_id
                        AND t.role='CLIENT_OWNER' AND t.is_active) THEN 'Dono — vê tudo'
           ELSE COALESCE((SELECT count(*)::text || ' concessão(ões) de dados'
                          FROM user_scope us WHERE us.user_id=u.id AND us.company_id=p_company_id AND us.ativo),
                         'Sem acesso a dados')
         END AS resumo
  FROM user_companies uc JOIN users u ON u.id = uc.user_id
  WHERE uc.company_id = p_company_id
  ORDER BY u.full_name NULLS LAST, u.email;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_owner_scope_membros(uuid) TO authenticated;

-- 2 · setores da empresa (+ a planta = "todos os setores") pro picker "o que a pessoa pode ver".
CREATE OR REPLACE FUNCTION public.fn_owner_scope_unidades(p_company_id uuid)
RETURNS TABLE(id uuid, nome text, tipo text, is_todos boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.fn_owner_pode_gerir_escopo(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerir acessos desta empresa.';
  END IF;
  RETURN QUERY
  SELECT o.id, o.nome, o.tipo, (o.tipo IN ('planta','empresa')) AS is_todos
  FROM org_unidade o
  WHERE o.company_id = p_company_id AND o.ativo AND o.tipo IN ('empresa','planta','setor')
  ORDER BY CASE o.tipo WHEN 'empresa' THEN 0 WHEN 'planta' THEN 1 ELSE 2 END, o.nome;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_owner_scope_unidades(uuid) TO authenticated;

-- 3 · concessões atuais de uma pessoa (pra tela mostrar/editar).
CREATE OR REPLACE FUNCTION public.fn_owner_scope_listar(p_company_id uuid, p_user_id uuid)
RETURNS TABLE(scope_id uuid, unidade_id uuid, unidade_nome text, unidade_tipo text, dominios text[], nivel text, ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.fn_owner_pode_gerir_escopo(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerir acessos desta empresa.';
  END IF;
  RETURN QUERY
  SELECT us.id, us.org_unidade_id, o.nome, o.tipo, us.dominios, us.nivel, us.ativo
  FROM user_scope us JOIN org_unidade o ON o.id = us.org_unidade_id
  WHERE us.user_id = p_user_id AND us.company_id = p_company_id
  ORDER BY us.ativo DESC, o.nome;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_owner_scope_listar(uuid, uuid) TO authenticated;

-- 4 · CONCEDER: uma ou mais unidades × domínios × nível. Aditivo (upsert por unidade). Trilha.
CREATE OR REPLACE FUNCTION public.fn_owner_scope_conceder(
  p_company_id uuid, p_user_id uuid, p_unidade_ids uuid[], p_dominios text[], p_nivel text, p_papel_rotulo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  IF coalesce(p_nivel,'') NOT IN ('ver','editar') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nível inválido.');
  END IF;
  -- toda unidade tem que ser DESTA empresa (nunca fora)
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
END $$;
GRANT EXECUTE ON FUNCTION public.fn_owner_scope_conceder(uuid, uuid, uuid[], text[], text, text) TO authenticated;

-- 5 · REVOGAR (soft: ativo=false). Trilha.
CREATE OR REPLACE FUNCTION public.fn_owner_scope_revogar(p_scope_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row user_scope; v_uid uuid; v_email text;
BEGIN
  SELECT * INTO v_row FROM user_scope WHERE id=p_scope_id;
  IF v_row IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Concessão não encontrada.'); END IF;
  IF NOT public.fn_owner_pode_gerir_escopo(v_row.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  v_uid := auth.uid();
  SELECT email INTO v_email FROM users WHERE id=v_uid;
  UPDATE user_scope SET ativo=false WHERE id=p_scope_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_row.company_id, v_uid, v_email, 'user_scope', v_row.user_id::text, 'ESCOPO_REVOGADO',
          jsonb_build_object('scope_id', p_scope_id, 'unidade', v_row.org_unidade_id, 'dominios', v_row.dominios));
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_owner_scope_revogar(uuid) TO authenticated;
