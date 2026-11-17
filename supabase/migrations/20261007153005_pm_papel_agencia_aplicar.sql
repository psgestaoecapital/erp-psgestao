-- ============================================================
-- P&M · "Papel na agência" — aplicar o papel da vertical 'pm' a uma pessoa (Eng. Chefe 07/10, RD-90/91)
-- Prova (07/10, só leitura): fn_acesso_efetivo lê user_scope.papel_slug → rbac_papel_acesso e limita pelo
-- user_scope.nivel (teto). Os 7 da Pdois NÃO têm linha em user_scope e a empresa não tem org_unidade (NOT NULL).
-- Nenhuma policy/view lê papel_slug; os únicos consumidores são fn_nr36_pode_subir, fn_oficina_papel, fn_os_criar.
-- RISCO ACHADO: fn_nr36_pode_subir libera quem NÃO tem papel (tem_papel=false); quem passa a ter papel exige
-- docs_regulatorios. Papel de agência não tem docs_regulatorios → gravar o papel tiraria o envio de NR-36.
-- Correção: só papel de vertical <> 'pm' conta como "tem papel" nessa guarda (resto da função igual).
-- Nada é aplicado a ninguém aqui: só funções. O CEO aplica pela tela.
-- ============================================================

-- 1) Guarda do NR-36: papel da agência não decide o envio de NR-36 (comportamento atual preservado).
CREATE OR REPLACE FUNCTION public.fn_nr36_pode_subir(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
     AND (
       COALESCE((public.fn_acesso_efetivo(auth.uid(), p_company_id) -> 'decidido' ->> 'tem_papel')::boolean, false) = false
       OR EXISTS (SELECT 1 FROM public.user_scope us JOIN public.rbac_papel rp ON rp.slug = us.papel_slug
                  WHERE us.user_id = auth.uid() AND us.company_id = p_company_id AND rp.vertical = 'pm')
       OR (public.fn_acesso_efetivo(auth.uid(), p_company_id) -> 'acessos' ->> 'docs_regulatorios') IN ('editar','aprovar')
     );
$function$;

-- 2) Catálogo + papel atual de cada pessoa da empresa (só quem gere acessos da empresa).
CREATE OR REPLACE FUNCTION public.fn_pm_papel_agencia_listar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  RETURN jsonb_build_object('ok', true,
    'papeis', COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', p.slug, 'nome', p.nome, 'descricao', p.descricao,
        'acessos', COALESCE((SELECT jsonb_object_agg(a.subgrupo, a.nivel) FROM rbac_papel_acesso a WHERE a.papel_slug = p.slug), '{}'::jsonb))
        ORDER BY p.nome) FROM rbac_papel p WHERE p.vertical = 'pm' AND p.ativo), '[]'::jsonb),
    'pessoas', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', u.id, 'nome', COALESCE(u.full_name, u.email), 'email', u.email,
        'cargo_empresa', uc.role, 'papel_slug', (SELECT us.papel_slug FROM user_scope us WHERE us.user_id = u.id AND us.company_id = p_company_id LIMIT 1))
        ORDER BY COALESCE(u.full_name, u.email))
      FROM user_companies uc JOIN users u ON u.id = uc.user_id WHERE uc.company_id = p_company_id), '[]'::jsonb));
END $function$;

-- 3) Antes/depois (somente leitura): o que a pessoa vê hoje e o que passa a ver com o papel.
CREATE OR REPLACE FUNCTION public.fn_pm_papel_agencia_simular(p_company_id uuid, p_user_id uuid, p_papel_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_antes jsonb; v_depois jsonb; v_teto text;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = p_user_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta pessoa não faz parte da empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rbac_papel WHERE slug = p_papel_slug AND vertical = 'pm' AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Papel inválido para a agência.');
  END IF;
  v_antes := public.fn_acesso_efetivo(p_user_id, p_company_id) -> 'acessos';
  SELECT (ARRAY['ver','filtrar','editar','aprovar'])[max(array_position(ARRAY['ver','filtrar','editar','aprovar'], nivel))]
    INTO v_teto FROM rbac_papel_acesso WHERE papel_slug = p_papel_slug;
  v_depois := COALESCE((SELECT jsonb_object_agg(subgrupo, nivel) FROM rbac_papel_acesso WHERE papel_slug = p_papel_slug), '{}'::jsonb);
  RETURN jsonb_build_object('ok', true,
    'papel_atual', (SELECT papel_slug FROM user_scope WHERE user_id = p_user_id AND company_id = p_company_id LIMIT 1),
    'papel_novo', p_papel_slug,
    'acessos_antes', COALESCE(v_antes, '{}'::jsonb),
    'acessos_depois', v_depois,
    'teto', COALESCE(v_teto, 'ver'),
    'telas_continuam', jsonb_build_array('Jobs', 'Pauta', 'Meus Trabalhos', 'Painel de Jobs'),
    'observacao', 'As telas de P&M seguem o cargo na empresa (user_companies/tenant_user_roles); o papel acrescenta o detalhe por área (acessos) e não remove nenhuma tela. O envio de NR-36 não muda.');
END $function$;

-- 4) Aplicar (ou limpar com NULL) o papel da agência. Cria a unidade "empresa" se a agência não tiver nenhuma.
CREATE OR REPLACE FUNCTION public.fn_pm_papel_agencia_definir(p_company_id uuid, p_user_id uuid, p_papel_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_email text; v_org uuid; v_teto text; v_antes text; v_nome text;
BEGIN
  IF NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão para gerir acessos desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = p_user_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta pessoa não faz parte da empresa.');
  END IF;
  SELECT papel_slug INTO v_antes FROM user_scope WHERE user_id = p_user_id AND company_id = p_company_id LIMIT 1;

  IF p_papel_slug IS NULL THEN
    UPDATE user_scope SET papel_slug = NULL WHERE user_id = p_user_id AND company_id = p_company_id AND papel_slug IN (SELECT slug FROM rbac_papel WHERE vertical = 'pm');
  ELSE
    SELECT nome INTO v_nome FROM rbac_papel WHERE slug = p_papel_slug AND vertical = 'pm' AND ativo;
    IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Papel inválido para a agência.'); END IF;
    -- nunca sobrescreve papel de outra vertical (ex.: industrial) nem tira escopo que já existe
    IF v_antes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rbac_papel WHERE slug = v_antes AND vertical = 'pm') THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'A pessoa já tem papel de outra área ('||v_antes||'); não foi alterado.');
    END IF;
    SELECT (ARRAY['ver','filtrar','editar','aprovar'])[max(array_position(ARRAY['ver','filtrar','editar','aprovar'], nivel))]
      INTO v_teto FROM rbac_papel_acesso WHERE papel_slug = p_papel_slug;
    v_teto := COALESCE(v_teto, 'ver');

    IF EXISTS (SELECT 1 FROM user_scope WHERE user_id = p_user_id AND company_id = p_company_id) THEN
      UPDATE user_scope SET papel_slug = p_papel_slug, papel_rotulo = v_nome, ativo = true,
             nivel = (ARRAY['ver','filtrar','editar','aprovar'])[GREATEST(array_position(ARRAY['ver','filtrar','editar','aprovar'], nivel),
                                                                           array_position(ARRAY['ver','filtrar','editar','aprovar'], v_teto))]
       WHERE user_id = p_user_id AND company_id = p_company_id;
    ELSE
      SELECT id INTO v_org FROM org_unidade WHERE company_id = p_company_id AND ativo ORDER BY (parent_id IS NULL) DESC, ordem, criado_em LIMIT 1;
      IF v_org IS NULL THEN
        INSERT INTO org_unidade (company_id, tipo, nome, ordem) VALUES (p_company_id, 'empresa', 'Agência', 0) RETURNING id INTO v_org;
      END IF;
      INSERT INTO user_scope (user_id, company_id, org_unidade_id, dominios, nivel, papel_rotulo, papel_slug, ativo, observacao)
      VALUES (p_user_id, p_company_id, v_org, '{}'::text[], v_teto, v_nome, p_papel_slug, true, 'Papel na agência (P&M) aplicado pela tela');
    END IF;
  END IF;

  SELECT email INTO v_email FROM users WHERE id = v_uid;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, v_uid, v_email, 'user_scope', p_user_id::text, 'PAPEL_AGENCIA_APLICADO',
          jsonb_build_object('papel_antes', v_antes, 'papel_slug', p_papel_slug));
  RETURN jsonb_build_object('ok', true, 'papel_antes', v_antes, 'papel_depois', p_papel_slug);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_papel_agencia_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_papel_agencia_simular(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_papel_agencia_definir(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_papel_agencia_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_papel_agencia_simular(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_papel_agencia_definir(uuid, uuid, text) TO authenticated;

-- fn_nr36_pode_subir: mesmo ACL que já está em produção (authenticated + service_role, sem anon).
REVOKE ALL ON FUNCTION public.fn_nr36_pode_subir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pode_subir(uuid) TO authenticated, service_role;
