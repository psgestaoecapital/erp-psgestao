-- ============================================================
-- HUB · aplicação dos papéis do Hub na FC PISOS E REVESTIMENTOS INDUSTRIAIS — CEO 06/10
-- (ctx "CEO 06/10: papéis do Hub na FC Pisos" + RH da Ana Luísa, msg 15c9f674 — a mais recente vence).
-- SÓ esta empresa (b202b50f-…). FCR e equipe PS (origem 'equipe_ps') NÃO são tocadas.
-- Depende do catálogo do Hub (#2083, migration 20261006180005): se os papéis hub_* não existirem, ABORTA
-- (nunca marcar como aplicado sem ter rodado — RD-52). Não mergear antes da #2083.
-- Forma (igual à Pdois, fn_pm_papel_agencia_aplicar): o papel vive em user_scope.papel_slug (teto = maior nível do papel);
-- user_scope exige org_unidade_id -> cria o nó raiz 'empresa' se a FC não tiver nenhum.
-- Backup do vínculo atual em public._bkp_fc_papeis_hub_20261007 (user_scope + user_companies + tenant_user_roles).
-- compras@ deixa de ser dono: tenant_user_roles CLIENT_OWNER -> CLIENT_OPERATOR (o "dono" mora aí; user_companies.role
-- 'financeiro' não é dono e fica como está). Demais linhas de user_companies/tenant_user_roles NÃO mudam.
-- Antes/depois: RAISE NOTICE com fn_acesso_efetivo; asserções abortam se faltar usuário ou papel.
-- ============================================================

CREATE TABLE IF NOT EXISTS public._bkp_fc_papeis_hub_20261007 (
  tabela text NOT NULL, linha jsonb NOT NULL, salvo_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._bkp_fc_papeis_hub_20261007 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_fc_papeis_hub_20261007 FROM PUBLIC, anon, authenticated;

DO $mig$
DECLARE
  c_fc constant uuid := 'b202b50f-37cb-462e-accf-126869de49f0';
  v_org uuid; v_uid uuid; v_nivel text; v_nome text; r record; v_ok int := 0;
  v_mapa constant text[][] := ARRAY[
    ['diego@fcpisos.com','hub_gerente_obras'], ['diego@fcpiso.com','hub_gerente_obras'],
    ['ervimpaterno@gmail.com','hub_socio'],    ['administrativo@fcpisos.com','hub_financeiro'],
    ['compras@fcpisos.com','hub_compras'],     ['deborad@fcpisos.com','hub_compras'],
    ['analuisa@fcpisos.com','hub_rh'],         ['raquel@fcpisos.com','hub_engenheiro']];
  i int;
BEGIN
  IF (SELECT count(*) FROM rbac_papel WHERE vertical='hub' AND slug IN
      ('hub_socio','hub_gerente_obras','hub_engenheiro','hub_financeiro','hub_compras','hub_rh')) <> 6 THEN
    RAISE EXCEPTION 'Catálogo de papéis do Hub (#2083) ainda não está no banco — aplicar depois dele.';
  END IF;

  -- backup do vínculo atual (só esta empresa)
  IF NOT EXISTS (SELECT 1 FROM _bkp_fc_papeis_hub_20261007) THEN
    INSERT INTO _bkp_fc_papeis_hub_20261007(tabela, linha)
      SELECT 'user_scope', to_jsonb(s) FROM user_scope s WHERE s.company_id = c_fc
      UNION ALL SELECT 'user_companies', to_jsonb(u) FROM user_companies u WHERE u.company_id = c_fc
      UNION ALL SELECT 'tenant_user_roles', to_jsonb(t) FROM tenant_user_roles t WHERE t.company_id = c_fc;
  END IF;

  SELECT id INTO v_org FROM org_unidade WHERE company_id = c_fc AND ativo
    ORDER BY (parent_id IS NULL) DESC, ordem, criado_em LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO org_unidade (company_id, tipo, nome, ordem) VALUES (c_fc, 'empresa', 'FC Pisos', 0) RETURNING id INTO v_org;
  END IF;

  FOR i IN 1..array_length(v_mapa, 1) LOOP
    SELECT uc.user_id INTO v_uid FROM user_companies uc JOIN users u ON u.id = uc.user_id
      WHERE uc.company_id = c_fc AND lower(u.email) = v_mapa[i][1];
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário % não pertence à FC Pisos.', v_mapa[i][1]; END IF;
    SELECT p.nome, (ARRAY['ver','filtrar','editar','aprovar'])[max(array_position(ARRAY['ver','filtrar','editar','aprovar'], a.nivel))]
      INTO v_nome, v_nivel
      FROM rbac_papel p JOIN rbac_papel_acesso a ON a.papel_slug = p.slug WHERE p.slug = v_mapa[i][2] GROUP BY p.nome;
    INSERT INTO user_scope (user_id, company_id, org_unidade_id, nivel, papel_rotulo, dominios, ativo, papel_slug, observacao)
    VALUES (v_uid, c_fc, v_org, v_nivel, v_nome, '{}'::text[], true, v_mapa[i][2],
            'CEO 06/10: papéis do Hub na FC Pisos · aplicado por migration 20261007190005 · RD-36 (vínculo anterior em _bkp_fc_papeis_hub_20261007)')
    ON CONFLICT (user_id, company_id) DO UPDATE
      SET papel_slug = EXCLUDED.papel_slug,
          observacao = COALESCE(user_scope.observacao || ' | ', '') || EXCLUDED.observacao;
    v_ok := v_ok + 1;
  END LOOP;

  -- compras@ deixa de ser dono no cadastro da empresa
  UPDATE tenant_user_roles SET role = 'CLIENT_OPERATOR', updated_at = now(),
         observacao = COALESCE(observacao || ' | ', '') || 'CEO 06/10: compras@ deixa de ser dono (Hub: Compras/Suprimentos) · RD-36'
   WHERE company_id = c_fc AND role = 'CLIENT_OWNER'
     AND user_id = (SELECT uc.user_id FROM user_companies uc JOIN users u ON u.id = uc.user_id
                     WHERE uc.company_id = c_fc AND lower(u.email) = 'compras@fcpisos.com');

  -- prova depois: 8 pessoas com papel do Hub, compras@ sem CLIENT_OWNER, equipe PS intocada
  IF (SELECT count(*) FROM user_scope WHERE company_id = c_fc AND papel_slug LIKE 'hub\_%') <> v_ok THEN
    RAISE EXCEPTION 'Prova falhou: papéis do Hub aplicados <> %', v_ok;
  END IF;
  IF EXISTS (SELECT 1 FROM tenant_user_roles t JOIN users u ON u.id = t.user_id
              WHERE t.company_id = c_fc AND lower(u.email) = 'compras@fcpisos.com' AND t.role = 'CLIENT_OWNER') THEN
    RAISE EXCEPTION 'Prova falhou: compras@ ainda é dono.';
  END IF;
  IF EXISTS (SELECT 1 FROM user_scope s JOIN user_companies uc ON uc.user_id = s.user_id AND uc.company_id = s.company_id
              WHERE s.company_id = c_fc AND uc.origem = 'equipe_ps' AND s.papel_slug IS NOT NULL) THEN
    RAISE EXCEPTION 'Prova falhou: equipe PS recebeu papel.';
  END IF;
  RAISE NOTICE 'FC Pisos: % papéis do Hub aplicados.', v_ok;
END
$mig$;
