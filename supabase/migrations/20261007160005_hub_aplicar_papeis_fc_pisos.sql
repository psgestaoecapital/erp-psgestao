-- ============================================================
-- HUB · aplicar os papéis do Hub na FC PISOS E REVESTIMENTOS INDUSTRIAIS (só esta empresa)
-- Decisão do CEO 06/10 (ctx "CEO 06/10: papéis do Hub na FC Pisos"). Depende do catálogo de papéis do Hub
-- (migration 20261007150005, PR #2142): sem os papéis hub_* esta migration ABORTA (nada é gravado pela metade).
-- Prova (RD-38, 07/10): a FC tem 0 linhas em user_scope e 0 em org_unidade; o papel da vertical vive em
-- user_scope.papel_slug e só é lido por fn_acesso_efetivo — gravar NÃO retira nem concede tela hoje
-- (menus e RLS seguem user_companies.role). Por isso user_companies.role NÃO é alterado aqui.
-- "Dono no cadastro da empresa" = tenant_user_roles.role='CLIENT_OWNER': compras@ era CLIENT_OWNER -> passa a
-- CLIENT_OPERATOR (mesma forma de deborad@/administrativo@). Demais donos (Ervim, diego@fcpiso.com, Jordana) ficam.
-- Backup do vínculo atual em _bkp_hub_papeis_fc_20261007 (linhas de user_companies e tenant_user_roles dos 8 e-mails).
-- FCR e equipe PS não mudam. Ana Luísa = Gerente de obras (ctx); a troca para RH é passo separado (15c9f674).
-- ============================================================
DO $mig$
DECLARE
  v_fc  constant uuid := 'b202b50f-37cb-462e-accf-126869de49f0';
  v_org uuid; v_n int; v_antes_owner int; v_dep_owner int; v_rec record; v_teto text;
  v_map constant jsonb := jsonb_build_object(
    'diego@fcpisos.com','hub_gerente_obras', 'diego@fcpiso.com','hub_gerente_obras',
    'ervimpaterno@gmail.com','hub_socio', 'administrativo@fcpisos.com','hub_administrativo',
    'compras@fcpisos.com','hub_compras', 'deborad@fcpisos.com','hub_compras',
    'analuisa@fcpisos.com','hub_gerente_obras', 'raquel@fcpisos.com','hub_engenheiro');
BEGIN
  SET LOCAL lock_timeout = '5s';
  SELECT count(*) INTO v_n FROM rbac_papel WHERE vertical = 'hub'
    AND slug IN ('hub_socio','hub_gerente_obras','hub_engenheiro','hub_compras','hub_administrativo');
  IF v_n < 5 THEN
    RAISE EXCEPTION 'Catálogo de papéis do Hub ausente (% de 5): publicar a migration 20261007150005 antes.', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM user_scope WHERE company_id = v_fc) THEN
    RAISE EXCEPTION 'FC já tem user_scope: aplicação abortada para não sobrescrever (RD-36).';
  END IF;

  -- backup do vínculo atual (RLS ligada, sem policy: só service_role lê)
  CREATE TABLE IF NOT EXISTS public._bkp_hub_papeis_fc_20261007 (
    id bigserial PRIMARY KEY, tabela text NOT NULL, user_id uuid NOT NULL, email text, dados jsonb NOT NULL,
    criado_em timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public._bkp_hub_papeis_fc_20261007 ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public._bkp_hub_papeis_fc_20261007 FROM PUBLIC, anon, authenticated;
  INSERT INTO public._bkp_hub_papeis_fc_20261007 (tabela, user_id, email, dados)
    SELECT 'user_companies', uc.user_id, u.email, to_jsonb(uc) FROM user_companies uc JOIN auth.users u ON u.id = uc.user_id
     WHERE uc.company_id = v_fc AND u.email IN (SELECT jsonb_object_keys(v_map));
  INSERT INTO public._bkp_hub_papeis_fc_20261007 (tabela, user_id, email, dados)
    SELECT 'tenant_user_roles', t.user_id, u.email, to_jsonb(t) FROM tenant_user_roles t JOIN auth.users u ON u.id = t.user_id
     WHERE t.company_id = v_fc AND u.email IN (SELECT jsonb_object_keys(v_map));

  SELECT count(*) INTO v_antes_owner FROM tenant_user_roles WHERE company_id = v_fc AND role = 'CLIENT_OWNER' AND is_active;

  -- nó raiz da empresa (user_scope.org_unidade_id é NOT NULL)
  SELECT id INTO v_org FROM org_unidade WHERE company_id = v_fc AND ativo ORDER BY (parent_id IS NULL) DESC, ordem, criado_em LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO org_unidade (company_id, tipo, nome, ordem) VALUES (v_fc, 'empresa', 'FC Pisos', 0) RETURNING id INTO v_org;
  END IF;

  FOR v_rec IN
    SELECT uc.user_id, u.email, v_map->>u.email AS slug, p.nome
      FROM user_companies uc JOIN auth.users u ON u.id = uc.user_id
      JOIN rbac_papel p ON p.slug = v_map->>u.email
     WHERE uc.company_id = v_fc AND v_map ? u.email
  LOOP
    SELECT (ARRAY['ver','filtrar','editar','aprovar'])[max(array_position(ARRAY['ver','filtrar','editar','aprovar'], nivel))]
      INTO v_teto FROM rbac_papel_acesso WHERE papel_slug = v_rec.slug;
    INSERT INTO user_scope (user_id, company_id, org_unidade_id, nivel, papel_rotulo, dominios, ativo, papel_slug, observacao)
    VALUES (v_rec.user_id, v_fc, v_org, COALESCE(v_teto, 'ver'), v_rec.nome, '{}'::text[], true, v_rec.slug,
            'CEO 06/10 papéis do Hub na FC · RD-36: backup em _bkp_hub_papeis_fc_20261007 · aplicado em migration 07/10');
  END LOOP;

  UPDATE tenant_user_roles SET role = 'CLIENT_OPERATOR', updated_at = now(),
         observacao = COALESCE(observacao || ' | ', '') || 'CEO 06/10: deixa de ser dono (era CLIENT_OWNER); backup _bkp_hub_papeis_fc_20261007'
   WHERE company_id = v_fc AND role = 'CLIENT_OWNER' AND is_active
     AND user_id = (SELECT id FROM auth.users WHERE email = 'compras@fcpisos.com')
     AND NOT EXISTS (SELECT 1 FROM tenant_user_roles x WHERE x.user_id = tenant_user_roles.user_id AND x.company_id = v_fc AND x.role = 'CLIENT_OPERATOR');

  SELECT count(*) INTO v_dep_owner FROM tenant_user_roles WHERE company_id = v_fc AND role = 'CLIENT_OWNER' AND is_active;
  SELECT count(*) INTO v_n FROM user_scope WHERE company_id = v_fc AND papel_slug LIKE 'hub\_%';
  IF v_n <> 8 OR v_dep_owner <> v_antes_owner - 1 THEN
    RAISE EXCEPTION 'Prova depois falhou: user_scope hub=% (esperado 8), donos antes=% depois=% (esperado -1).', v_n, v_antes_owner, v_dep_owner;
  END IF;
END
$mig$;
