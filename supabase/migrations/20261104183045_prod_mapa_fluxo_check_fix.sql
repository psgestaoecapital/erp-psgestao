-- BUG P0 (Frioeste 04/11): /dashboard/produtividade/mapa — criar raia / "Começar pelo modelo"
-- estourava o constraint prod_fluxo_check (coerência modo x produto_id).
-- Causa: fn_prod_fluxo_salvar e fn_prod_modelo_aplicar inseriam modo='fluxo', valor que
-- NÃO satisfaz nem prod_fluxo_modo_check (modo IN compartilhado/especifico) nem o
-- prod_fluxo_check ((compartilhado AND produto_id NULL) OR (especifico AND produto_id NOT NULL)).
-- Prova RD-38 (04/11): 'fluxo' = ANY(['compartilhado','especifico']) => FALSE.
-- O hotfix de produção (modelo -> 'compartilhado') já destravou a Frioeste ao vivo; esta
-- migration VERSIONA o conserto no repo (senão uma migration futura ressuscitava o bug) e
-- endurece as duas RPCs. Aditiva (CREATE OR REPLACE), sem tocar dado de cliente.

-- 1. Criar/editar raia: alinhar modo x produto_id e endurecer a guarda de empresa.
CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_salvar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid := NULLIF(p_dados->>'id','')::uuid; v_comp uuid := NULLIF(p_dados->>'company_id','')::uuid;
        v_plant uuid := NULLIF(p_dados->>'plant_id','')::uuid; v_setor uuid := NULLIF(p_dados->>'setor_id','')::uuid;
        v_nome text := btrim(coalesce(p_dados->>'nome','')); v_ordem int := NULLIF(p_dados->>'ordem','')::int;
        v_dir text := coalesce(NULLIF(p_dados->>'direcao',''),'desmontagem');
        v_modo_cur text; v_produto_cur uuid;
        v_modo text; v_produto uuid;
BEGIN
  IF v_dir NOT IN ('desmontagem','montagem') THEN RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;
  IF v_id IS NOT NULL THEN
    SELECT company_id, plant_id, setor_id, modo, produto_id INTO v_comp, v_plant, v_setor, v_modo_cur, v_produto_cur
      FROM prod_fluxo WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
    v_setor := coalesce(NULLIF(p_dados->>'setor_id','')::uuid, v_setor);
  END IF;
  -- guarda explícita (catch do revisor): empresa obrigatória + pertence ao usuário
  IF v_comp IS NULL OR NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio'); END IF;
  IF v_plant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = v_plant AND ip.company_id = v_comp) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_de_outra_empresa'); END IF;
  IF v_setor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prod_setor ps WHERE ps.id = v_setor AND ps.company_id = v_comp) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_de_outra_empresa'); END IF;

  -- modo x produto_id: só muda o que vier no payload; raia nova nasce compartilhada.
  v_modo := coalesce(NULLIF(p_dados->>'modo',''), v_modo_cur, 'compartilhado');
  IF v_modo NOT IN ('compartilhado','especifico') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modo_invalido'); END IF;
  IF p_dados ? 'produto_id' THEN v_produto := NULLIF(p_dados->>'produto_id','')::uuid;
  ELSE v_produto := v_produto_cur; END IF;
  IF v_modo = 'compartilhado' THEN
    v_produto := NULL;                       -- compartilhada nunca carrega produto
  ELSE
    IF v_produto IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'produto_obrigatorio'); END IF;
    IF NOT EXISTS (SELECT 1 FROM prod_produto WHERE id = v_produto AND company_id = v_comp) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'produto_de_outra_empresa'); END IF;
  END IF;

  IF v_id IS NULL THEN
    IF v_comp IS NULL OR v_plant IS NULL OR v_setor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'contexto_incompleto'); END IF;
    IF v_ordem IS NULL THEN
      SELECT coalesce(max(ordem),0)+1 INTO v_ordem FROM prod_fluxo
       WHERE company_id=v_comp AND plant_id=v_plant AND deleted_at IS NULL;
    END IF;
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, produto_id, ordem, direcao, ativo)
    VALUES (v_comp, v_plant, v_setor, v_nome, v_modo, v_produto, v_ordem, v_dir, true) RETURNING id INTO v_id;
  ELSE
    UPDATE prod_fluxo SET nome = v_nome, setor_id = v_setor, direcao = v_dir, modo = v_modo, produto_id = v_produto,
      ordem = coalesce(v_ordem, ordem), updated_at = now() WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) TO authenticated;

-- 2. Aplicar modelo: raias nascem compartilhadas (produto_id NULL) + trava de duplicação
--    + guarda NULL explícita. Novo parâmetro p_confirmar (default false) exige DROP do antigo
--    para não deixar duas sobrecargas (ambiguidade de chamada).
DROP FUNCTION IF EXISTS public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.fn_prod_modelo_aplicar(p_company_id uuid, p_plant_id uuid, p_modelo text, p_setor_id uuid, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_setor uuid := p_setor_id; v_mf record; v_me record; v_fluxo uuid; v_posto uuid; v_ordem_raia int; v_n int := 0;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_plant_id IS NULL OR NOT EXISTS (SELECT 1 FROM industrial_plants ip WHERE ip.id = p_plant_id AND ip.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_de_outra_empresa'); END IF;
  IF p_setor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prod_setor ps WHERE ps.id = p_setor_id AND ps.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_de_outra_empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM prod_modelo_fluxo WHERE modelo = p_modelo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modelo_inexistente'); END IF;
  -- trava de duplicação: já há raias ativas nesta planta → só aplica com confirmação explícita
  IF NOT p_confirmar AND EXISTS (SELECT 1 FROM prod_fluxo WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modelo_ja_aplicado'); END IF;
  IF v_setor IS NULL THEN
    SELECT id INTO v_setor FROM prod_setor WHERE company_id=p_company_id AND plant_id=p_plant_id AND ativo IS NOT FALSE ORDER BY ordem LIMIT 1;
  END IF;
  IF v_setor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_setor'); END IF;

  -- ordem: max(ordem)+1 por raia. Em concorrência extrema (dois cliques simultâneos) pode
  -- repetir a ordem — risco baixo (usuário único por planta); a reordenação manual corrige.
  SELECT coalesce(max(ordem),0) INTO v_ordem_raia FROM prod_fluxo
    WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL;

  FOR v_mf IN SELECT * FROM prod_modelo_fluxo WHERE modelo = p_modelo ORDER BY ordem LOOP
    v_ordem_raia := v_ordem_raia + 1;
    -- raia do modelo nasce compartilhada (produto_id NULL): satisfaz prod_fluxo_check
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, ordem, direcao, ativo)
    VALUES (p_company_id, p_plant_id, v_setor, v_mf.nome, 'compartilhado', v_ordem_raia, v_mf.direcao, true) RETURNING id INTO v_fluxo;
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
REVOKE ALL ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid, boolean) TO authenticated;
