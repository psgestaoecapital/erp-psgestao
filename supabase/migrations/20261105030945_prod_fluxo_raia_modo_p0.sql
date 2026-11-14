-- BUG P0 (CEO, visita Frioeste 04/11): criar raia / "Começar pelo modelo" em /dashboard/produtividade/mapa
-- estourava `new row for relation "prod_fluxo" violates check constraint "prod_fluxo_check"`.
--
-- CAUSA (RD-38, provado no banco):
--   * prod_fluxo_modo_check  => modo IN ('compartilhado','especifico')
--   * prod_fluxo_check       => (modo='compartilhado' AND produto_id IS NULL) OR (modo='especifico' AND produto_id IS NOT NULL)
--   fn_prod_fluxo_salvar e fn_prod_modelo_aplicar inseriam modo='fluxo' (valor morto), violando os dois checks.
--   A hotfix em produção já corrigiu fn_prod_modelo_aplicar (modo='compartilhado'), mas NÃO fn_prod_fluxo_salvar
--   (ainda quebrava "criar raia do zero"), e o repo tinha 'fluxo' nos DOIS (divergência banco×repo). Esta migration
--   VERSIONA o conserto para que nenhuma migration futura ressuscite o bug. Espelha fn_prod_fluxo_completo (RD-26).
--
-- Como prod_fluxo_modo_check já barra 'fluxo', NÃO existe nenhuma linha com modo='fluxo' em produção: conserto de
-- código puro, sem tocar dado de cliente. Migration aditiva (CREATE OR REPLACE / DROP+CREATE de função), RLS inalterada.

-- 1) Criar/editar raia: modo coerente com produto_id (espelha o constraint). Guard de empresa explícito (NULL barrado).
CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_salvar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid := NULLIF(p_dados->>'id','')::uuid; v_comp uuid := NULLIF(p_dados->>'company_id','')::uuid;
        v_plant uuid := NULLIF(p_dados->>'plant_id','')::uuid; v_setor uuid := NULLIF(p_dados->>'setor_id','')::uuid;
        v_nome text := btrim(coalesce(p_dados->>'nome','')); v_ordem int := NULLIF(p_dados->>'ordem','')::int;
        v_dir text := coalesce(NULLIF(p_dados->>'direcao',''),'desmontagem');
        v_tem_modo boolean := (p_dados ? 'modo');
        v_modo text := coalesce(NULLIF(p_dados->>'modo',''),'compartilhado');
        v_prod uuid := NULLIF(p_dados->>'produto_id','')::uuid;
BEGIN
  IF v_dir NOT IN ('desmontagem','montagem') THEN RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;
  IF v_modo NOT IN ('compartilhado','especifico') THEN RETURN jsonb_build_object('ok', false, 'erro', 'modo_invalido'); END IF;
  -- coerência modo×produto (mesma regra do prod_fluxo_check): nunca deixa estourar o constraint cru
  IF v_modo = 'compartilhado' THEN
    v_prod := NULL;
  ELSIF v_prod IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'escolha o produto da raia');
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT company_id, plant_id, setor_id INTO v_comp, v_plant, v_setor FROM prod_fluxo WHERE id = v_id;
    IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'raia_nao_encontrada'); END IF;
    v_setor := coalesce(NULLIF(p_dados->>'setor_id','')::uuid, v_setor);
  END IF;
  IF v_comp IS NULL OR NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
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
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, produto_id, ordem, direcao, ativo)
    VALUES (v_comp, v_plant, v_setor, v_nome, v_modo, v_prod, v_ordem, v_dir, true) RETURNING id INTO v_id;
  ELSE
    -- só altera modo/produto quando o chamador os envia; edição de nome/direção não mexe na coerência existente
    UPDATE prod_fluxo SET nome = v_nome, setor_id = v_setor, direcao = v_dir,
      modo = CASE WHEN v_tem_modo THEN v_modo ELSE modo END,
      produto_id = CASE WHEN v_tem_modo THEN v_prod ELSE produto_id END,
      ordem = coalesce(v_ordem, ordem), updated_at = now() WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_fluxo_salvar(jsonb) TO authenticated;

-- 2) Aplicar modelo: versiona a hotfix (modo='compartilhado'), trava de duplicação (reaplicar duplicava tudo),
--    guard de empresa explícito. Assinatura ganha p_forcar (default false) p/ a tela confirmar "aplicar mesmo assim".
DROP FUNCTION IF EXISTS public.fn_prod_modelo_aplicar(uuid, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.fn_prod_modelo_aplicar(p_company_id uuid, p_plant_id uuid, p_modelo text, p_setor_id uuid, p_forcar boolean DEFAULT false)
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
  -- trava de duplicação: reaplicar o modelo em planta que já tem raias duplicava raias e postos (clique duplo)
  IF NOT p_forcar AND EXISTS (SELECT 1 FROM prod_fluxo WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modelo_ja_aplicado'); END IF;
  IF v_setor IS NULL THEN
    SELECT id INTO v_setor FROM prod_setor WHERE company_id=p_company_id AND plant_id=p_plant_id AND ativo IS NOT FALSE ORDER BY ordem LIMIT 1;
  END IF;
  IF v_setor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_setor'); END IF;

  SELECT coalesce(max(ordem),0) INTO v_ordem_raia FROM prod_fluxo
    WHERE company_id=p_company_id AND plant_id=p_plant_id AND deleted_at IS NULL;

  FOR v_mf IN SELECT * FROM prod_modelo_fluxo WHERE modelo = p_modelo ORDER BY ordem LOOP
    v_ordem_raia := v_ordem_raia + 1;
    -- raias do modelo nascem compartilhadas (produto_id NULL); etapas específicas ganham produto ao editar a raia
    INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, produto_id, ordem, direcao, ativo)
    VALUES (p_company_id, p_plant_id, v_setor, v_mf.nome, 'compartilhado', NULL, v_ordem_raia, v_mf.direcao, true) RETURNING id INTO v_fluxo;
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
