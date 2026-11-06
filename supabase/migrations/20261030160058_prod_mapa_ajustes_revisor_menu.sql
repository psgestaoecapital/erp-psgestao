-- Produtividade · Mapa do fluxo — ajustes do revisor na A (#3404) e menu da tela (#3405). Code: dev7claudeps. Aditiva/segurança.
-- 1) prod_modelo_* (modelos globais): sem policy permissiva e sem GRANT SELECT — leitura só pelas RPCs (SECURITY DEFINER).
-- 2) fn_prod_fluxo_salvar / fn_prod_modelo_aplicar: planta e setor têm de ser da mesma empresa.
-- 3) fn_prod_mapa_completo: o JOIN de setor filtra a empresa.
-- 4) Menu: Indústria › Produtividade › "Mapa do fluxo" (primeira posição), module_catalog + plan_modules + system_screens.

DROP POLICY IF EXISTS prod_modelo_fluxo_ler ON public.prod_modelo_fluxo;
DROP POLICY IF EXISTS prod_modelo_etapa_ler ON public.prod_modelo_etapa;
REVOKE ALL ON public.prod_modelo_fluxo FROM anon, authenticated;
REVOKE ALL ON public.prod_modelo_etapa FROM anon, authenticated;

-- 3. Mapa completo (JOIN de setor por empresa)
CREATE OR REPLACE FUNCTION public.fn_prod_mapa_completo(p_company_id uuid, p_plant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_raias jsonb; v_modelos jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ordem')::int, r->>'nome'), '[]'::jsonb) INTO v_raias FROM (
    SELECT jsonb_build_object(
      'id', f.id, 'nome', f.nome, 'ordem', f.ordem, 'direcao', f.direcao,
      'setor_id', f.setor_id, 'setor_nome', s.nome,
      'atividades', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'ordem', e.ordem, 'nome', COALESCE(e.nome, p.atividade), 'tipo', e.tipo,
          'tempo_ciclo_seg', e.tempo_ciclo_seg, 'pessoas', e.pessoas, 'unidade', e.unidade,
          'posto_id', e.posto_id, 'posto_numero', p.numero, 'posto_atividade', p.atividade
        ) ORDER BY e.ordem, COALESCE(e.nome, p.atividade))
        FROM prod_fluxo_etapa e LEFT JOIN prod_posto p ON p.id = e.posto_id
        WHERE e.fluxo_id = f.id AND e.deleted_at IS NULL), '[]'::jsonb),
      'entra', COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object('produto_id', es.origem_produto_id, 'codigo', po.codigo, 'nome', po.nome))
        FROM prod_estrutura es JOIN prod_produto po ON po.id = es.origem_produto_id
        WHERE es.fluxo_id = f.id AND es.company_id = p_company_id AND es.ativo), '[]'::jsonb),
      'sai', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('produto_id', es.produto_id, 'codigo', pd.codigo, 'nome', pd.nome,
                 'tipo_saida', es.tipo_saida, 'rendimento_padrao_pct', es.rendimento_padrao_pct))
        FROM prod_estrutura es JOIN prod_produto pd ON pd.id = es.produto_id
        WHERE es.fluxo_id = f.id AND es.company_id = p_company_id AND es.ativo), '[]'::jsonb)
    ) AS r
    FROM prod_fluxo f LEFT JOIN prod_setor s ON s.id = f.setor_id AND s.company_id = f.company_id
    WHERE f.company_id = p_company_id AND f.plant_id = p_plant_id AND f.deleted_at IS NULL
  ) t;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('modelo', modelo, 'modelo_nome', modelo_nome, 'segmento', segmento)), '[]'::jsonb)
    INTO v_modelos FROM prod_modelo_fluxo;

  RETURN jsonb_build_object('ok', true, 'raias', v_raias, 'modelos', v_modelos);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_mapa_completo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_mapa_completo(uuid, uuid) TO authenticated;

-- 2a. Raia: planta/setor da empresa
CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_salvar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid := NULLIF(p_dados->>'id','')::uuid; v_comp uuid := NULLIF(p_dados->>'company_id','')::uuid;
        v_plant uuid := NULLIF(p_dados->>'plant_id','')::uuid; v_setor uuid := NULLIF(p_dados->>'setor_id','')::uuid;
        v_nome text := btrim(coalesce(p_dados->>'nome','')); v_ordem int := NULLIF(p_dados->>'ordem','')::int;
        v_dir text := coalesce(NULLIF(p_dados->>'direcao',''),'desmontagem');
BEGIN
  IF v_dir NOT IN ('desmontagem','montagem') THEN RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;
  IF v_id IS NOT NULL THEN
    SELECT company_id, plant_id, setor_id INTO v_comp, v_plant, v_setor FROM prod_fluxo WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
    v_setor := coalesce(NULLIF(p_dados->>'setor_id','')::uuid, v_setor);
  END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;
  IF v_plant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = v_plant AND ip.company_id = v_comp) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_de_outra_empresa'); END IF;
  IF v_setor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prod_setor ps WHERE ps.id = v_setor AND ps.company_id = v_comp) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_de_outra_empresa'); END IF;
  IF v_id IS NULL THEN
    IF v_comp IS NULL OR v_plant IS NULL OR v_setor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'contexto_incompleto'); END IF;
    IF v_ordem IS NULL THEN
      SELECT coalesce(max(ordem),0)+1 INTO v_ordem FROM prod_fluxo
       WHERE company_id=v_comp AND plant_id=v_plant AND deleted_at IS NULL;
    END IF;
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, ordem, direcao, ativo)
    VALUES (v_comp, v_plant, v_setor, v_nome, 'fluxo', v_ordem, v_dir, true) RETURNING id INTO v_id;
  ELSE
    UPDATE prod_fluxo SET nome = v_nome, setor_id = v_setor, direcao = v_dir,
      ordem = coalesce(v_ordem, ordem), updated_at = now() WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) TO authenticated;

-- 2b. Aplicar modelo: planta/setor da empresa
CREATE OR REPLACE FUNCTION public.fn_prod_modelo_aplicar(p_company_id uuid, p_plant_id uuid, p_modelo text, p_setor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_setor uuid := p_setor_id; v_mf record; v_me record; v_fluxo uuid; v_posto uuid; v_ordem_raia int; v_n int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_plant_id IS NULL OR NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = p_plant_id AND ip.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_de_outra_empresa'); END IF;
  IF p_setor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prod_setor ps WHERE ps.id = p_setor_id AND ps.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_de_outra_empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM prod_modelo_fluxo WHERE modelo = p_modelo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modelo_inexistente'); END IF;
  IF v_setor IS NULL THEN
    SELECT id INTO v_setor FROM prod_setor WHERE company_id=p_company_id AND plant_id=p_plant_id AND ativo IS NOT FALSE ORDER BY ordem LIMIT 1;
  END IF;
  IF v_setor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_setor'); END IF;

  SELECT coalesce(max(ordem),0) INTO v_ordem_raia FROM prod_fluxo
    WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL;

  FOR v_mf IN SELECT * FROM prod_modelo_fluxo WHERE modelo = p_modelo ORDER BY ordem LOOP
    v_ordem_raia := v_ordem_raia + 1;
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, ordem, direcao, ativo)
    VALUES (p_company_id, p_plant_id, v_setor, v_mf.nome, 'fluxo', v_ordem_raia, v_mf.direcao, true) RETURNING id INTO v_fluxo;
    FOR v_me IN SELECT * FROM prod_modelo_etapa WHERE modelo_fluxo_id = v_mf.id ORDER BY ordem LOOP
      v_posto := (fn_prod_posto_salvar(jsonb_build_object('company_id', p_company_id, 'plant_id', p_plant_id,
        'setor_id', v_setor, 'atividade', v_me.nome), auth.uid())->>'id')::uuid;
      INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, pessoas, unidade)
      VALUES (p_company_id, p_plant_id, v_fluxo, v_posto, v_me.ordem, v_me.nome, v_me.tipo, v_me.pessoas, v_me.unidade);
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'atividades', v_n);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid) TO authenticated;

-- 4. Menu (mesmo subgrupo e ramos das demais telas da Produtividade; ordem 204 = antes de "Produtividade" 205)
INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, icone, ordem, ativo, is_shared, ramos_aplicaveis, surface_in_groups) VALUES
  ('produtividade_mapa', 'Mapa do fluxo', '/dashboard/produtividade/mapa', 'industrial', 'produtividade', 'Workflow', 204, true, true, ARRAY['bovinos']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT base.plan_id, 'produtividade_mapa', base.is_default_active, base.minimum_sla, false
FROM public.plan_modules base
WHERE base.module_id = 'produtividade_apontamento'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = base.plan_id AND x.module_id = 'produtividade_mapa');

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, rpcs_chamadas, auditavel_robo, motivo_nao_auditavel)
VALUES
  ('prod_mapa', '/dashboard/produtividade/mapa', 'industria',
   'Mapa do fluxo', 'Fluxograma único por raias: atividades em ordem (posto, tipo, tempo de ciclo, pessoas, unidade), o que entra e sai de cada raia; criar, editar, mover e excluir (com motivo); começar por um modelo.', 'produtividade',
   'pronto', 'media', ARRAY['fn_prod_mapa_completo','fn_prod_fluxo_salvar','fn_prod_fluxo_excluir','fn_prod_fluxo_mover','fn_prod_etapa_salvar','fn_prod_etapa_excluir','fn_prod_etapa_mover','fn_prod_modelo_aplicar']::text[], false, 'Depende de empresa/planta selecionada e de dados do cliente.')
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, atualizado_em = now();
