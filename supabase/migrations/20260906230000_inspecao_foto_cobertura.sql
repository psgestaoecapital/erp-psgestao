-- ============================================================
-- ONDA 5B (backend) · fecha os 2 buracos da 5A que a tela precisa:
--   (1) gravar/remover foto da regiao; (2) cobertura no retorno (avaliados/total).
-- CREATE OR REPLACE das 2 funcoes existentes INTEIRAS, preservando os guards.
-- ============================================================

-- ------------------------------------------------------------
-- BLOCO 1 · foto da regiao (insp_foto). Storage privado (bucket revenda-veiculos, path vistorias/...).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_insp_foto_registrar(
  p_vistoria_id uuid, p_regiao_id uuid, p_storage_path text, p_legenda text, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_id uuid;
BEGIN
  SELECT * INTO v FROM insp_vistoria WHERE id = p_vistoria_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.situacao <> 'em_andamento' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_editavel', 'situacao', v.situacao); END IF;
  -- a regiao (quando informada) tem que ser do modelo desta vistoria
  IF p_regiao_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM insp_regiao r WHERE r.id = p_regiao_id AND r.modelo_id = v.modelo_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'regiao_nao_pertence_a_vistoria'); END IF;

  INSERT INTO insp_foto (company_id, vistoria_id, regiao_id, storage_path, legenda, criado_por)
  VALUES (v.company_id, p_vistoria_id, p_regiao_id, p_storage_path, p_legenda, p_user)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'foto_id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_insp_foto_remover(p_foto_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_sit text; v_path text;
BEGIN
  SELECT f.company_id, vi.situacao, f.storage_path INTO v_company, v_sit, v_path
    FROM insp_foto f JOIN insp_vistoria vi ON vi.id = f.vistoria_id WHERE f.id = p_foto_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'foto_nao_encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit <> 'em_andamento' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_editavel'); END IF;
  DELETE FROM insp_foto WHERE id = p_foto_id;
  -- devolve o path pro front apagar o objeto no storage (nao deixa lixo)
  RETURN jsonb_build_object('ok', true, 'storage_path_removido', v_path);
END $function$;

-- ------------------------------------------------------------
-- BLOCO 2 · cobertura. Uma vistoria concluida afirma "este carro foi verificado" — se 79 de 80
-- itens nao foram olhados, isso e falso (RD-51). Nao bloqueia, mas REGISTRA e MOSTRA.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_insp_vistoria_obter(p_vistoria_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_regioes jsonb; v_total int; v_aval int;
BEGIN
  SELECT * INTO v FROM insp_vistoria WHERE id = p_vistoria_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT jsonb_agg(reg ORDER BY (reg->>'ordem')::int) INTO v_regioes FROM (
    SELECT jsonb_build_object(
      'regiao_id', r.id, 'codigo', r.codigo, 'nome', r.nome, 'ordem', r.ordem,
      'foto_obrigatoria', r.foto_obrigatoria, 'foto_rotulo', r.foto_rotulo,
      'tem_foto', EXISTS (SELECT 1 FROM insp_foto f WHERE f.vistoria_id = v.id AND f.regiao_id = r.id),
      'fotos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('foto_id', f.id, 'storage_path', f.storage_path, 'legenda', f.legenda) ORDER BY f.criado_em), '[]'::jsonb)
                FROM insp_foto f WHERE f.vistoria_id = v.id AND f.regiao_id = r.id),
      'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'item_id', i.id, 'nome', i.nome, 'ordem', i.ordem, 'categoria_custo', i.categoria_custo,
                  'estado', resp.estado, 'descricao', resp.descricao,
                  'gasto_previsto', resp.gasto_previsto, 'gasto_realizado', resp.gasto_realizado,
                  'custo_id', resp.custo_id) ORDER BY i.ordem), '[]'::jsonb)
                FROM insp_item i
                LEFT JOIN insp_resposta resp ON resp.item_id = i.id AND resp.vistoria_id = v.id
                WHERE i.regiao_id = r.id AND i.ativo = true)
    ) AS reg
    FROM insp_regiao r WHERE r.modelo_id = v.modelo_id
  ) t;

  SELECT count(*) INTO v_total FROM insp_item i JOIN insp_regiao r ON r.id = i.regiao_id
    WHERE r.modelo_id = v.modelo_id AND i.ativo;
  SELECT count(*) INTO v_aval FROM insp_resposta resp
    WHERE resp.vistoria_id = v.id AND resp.estado IS NOT NULL;

  RETURN jsonb_build_object('ok', true,
    'vistoria', jsonb_build_object('id', v.id, 'situacao', v.situacao, 'km', v.km,
      'previsao_total', v.previsao_total, 'alvo_tabela', v.alvo_tabela, 'alvo_id', v.alvo_id,
      'iniciada_em', v.iniciada_em, 'concluida_em', v.concluida_em, 'observacao', v.observacao),
    'itens_total', v_total,
    'itens_avaliados', v_aval,
    'regioes', COALESCE(v_regioes, '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_insp_vistoria_concluir(p_vistoria_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_fotos jsonb; v_gastos jsonb; v_total int; v_aval int; v_cob numeric;
BEGIN
  SELECT * INTO v FROM insp_vistoria WHERE id = p_vistoria_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.situacao = 'concluida' THEN
    RETURN jsonb_build_object('ok', true, 'ja_concluida', true, 'previsao_total', v.previsao_total); END IF;
  IF v.situacao <> 'em_andamento' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_editavel', 'situacao', v.situacao); END IF;

  -- guard 1: regiao com foto_obrigatoria sem foto
  SELECT jsonb_agg(r.nome ORDER BY r.ordem) INTO v_fotos FROM insp_regiao r
   WHERE r.modelo_id = v.modelo_id AND r.foto_obrigatoria = true
     AND NOT EXISTS (SELECT 1 FROM insp_foto f WHERE f.vistoria_id = v.id AND f.regiao_id = r.id);

  -- guard 2: item em reparo/troca sem gasto_previsto
  SELECT jsonb_agg(i.nome ORDER BY i.nome) INTO v_gastos FROM insp_resposta resp
   JOIN insp_item i ON i.id = resp.item_id
   WHERE resp.vistoria_id = v.id AND resp.estado IN ('reparo','troca') AND resp.gasto_previsto IS NULL;

  IF v_fotos IS NOT NULL OR v_gastos IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pendencias',
      'fotos_faltando', COALESCE(v_fotos, '[]'::jsonb),
      'gastos_faltando', COALESCE(v_gastos, '[]'::jsonb));
  END IF;

  -- cobertura: NAO bloqueia (o vistoriador pode legitimamente nao avaliar tudo), mas registra
  SELECT count(*) INTO v_total FROM insp_item i JOIN insp_regiao r ON r.id = i.regiao_id
    WHERE r.modelo_id = v.modelo_id AND i.ativo;
  SELECT count(*) INTO v_aval FROM insp_resposta resp
    WHERE resp.vistoria_id = v.id AND resp.estado IS NOT NULL;
  v_cob := CASE WHEN v_total > 0 THEN round((v_aval::numeric / v_total * 100), 1) ELSE NULL END;

  UPDATE insp_vistoria
     SET situacao = 'concluida', concluida_em = now(),
         -- grava a cobertura de forma nao-destrutiva (nao apaga observacao do usuario)
         observacao = COALESCE(NULLIF(btrim(v.observacao),'') || ' | ', '')
                      || 'Cobertura na conclusao: ' || v_aval || ' de ' || v_total || ' itens avaliados (' || COALESCE(v_cob::text,'-') || '%)'
   WHERE id = v.id;

  RETURN jsonb_build_object('ok', true, 'previsao_total', v.previsao_total, 'concluida_em', now(),
    'itens_total', v_total, 'itens_avaliados', v_aval, 'cobertura_pct', v_cob);
END $function$;
