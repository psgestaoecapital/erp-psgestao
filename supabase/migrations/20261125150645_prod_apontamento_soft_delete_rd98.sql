-- RD-98 p4 (exclusão rastreável) › /dashboard/produtividade/apontamento.
-- Auditor (19/11, nota 93): fn_prod_apontamento_excluir fazia DELETE FÍSICO da linha em
-- prod_apontamento_hora (gravava valor_anterior em audit_log_global, mas sem soft-delete). RD-98 exige
-- soft-delete + a listagem filtrar os excluídos. Editar/Lançar e idempotência já estavam corretos.
--
-- Esta migration (ADITIVA):
--   1) adiciona excluido_em/excluido_por (colunas novas, NULL — metadado instantâneo, sem varredura);
--   2) fn_prod_apontamento_excluir: UPDATE excluido_em=now()/excluido_por=auth.uid() no lugar do DELETE
--      (idempotente: já excluído -> ok/ja_excluido; mantém o registro em audit_log_global);
--   3) fn_prod_apontamento_listar: passa a filtrar excluido_em IS NULL;
--   4) fn_prod_apontar_hora: no ON CONFLICT (relançar a MESMA hora/posto/produto) reseta
--      excluido_em/excluido_por para NULL — relançar "revive" o lançamento, sem linha-fantasma oculta.
--
-- Segurança: todas SECURITY DEFINER + SET search_path, guarda fn_prod_assert_planta (inalterada); escopo
-- por company_id/plant_id preservado. NÃO altera/apaga dado de cliente (converte delete em soft-delete).
-- Prova RD-38: o corpo inteiro roda em BEGIN…ROLLBACK e compila ('compilou'). SENSÍVEL (CREATE OR REPLACE
-- de funções existentes) -> label revisao-eng-chefe. RD-52: arquivo + PR, acima da main, faixa :46.

ALTER TABLE public.prod_apontamento_hora
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_excluir(p_company_id uuid, p_plant_id uuid, p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_row public.prod_apontamento_hora%ROWTYPE;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT * INTO v_row FROM public.prod_apontamento_hora
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF v_row.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_excluido', true); END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior)
  VALUES (p_company_id, auth.uid(), 'prod_apontamento_hora', p_id::text, 'delete', to_jsonb(v_row));

  UPDATE public.prod_apontamento_hora
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_listar(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'posto_id', a.posto_id, 'posto_numero', po.numero, 'posto_atividade', po.atividade,
           'produto_id', a.produto_id, 'produto_codigo', pr.codigo, 'produto_nome', pr.nome,
           'hora', a.hora, 'qtd_produzida', a.qtd_produzida, 'unidade', a.unidade,
           'pessoas_presentes', a.pessoas_presentes, 'fonte', a.fonte
         ) ORDER BY po.numero NULLS LAST, a.hora, pr.codigo), '[]'::jsonb) INTO v
    FROM public.prod_apontamento_hora a
    LEFT JOIN public.prod_posto po ON po.id = a.posto_id
    LEFT JOIN public.prod_produto pr ON pr.id = a.produto_id
   WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data
     AND a.excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'lancamentos', v);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_prod_apontar_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_produto_id uuid, p_data date, p_hora integer, p_qtd_produzida numeric, p_posto_id uuid DEFAULT NULL::uuid, p_etapa_id uuid DEFAULT NULL::uuid, p_tarefa_id uuid DEFAULT NULL::uuid, p_unidade text DEFAULT NULL::text, p_pessoas_presentes integer DEFAULT NULL::integer, p_fonte text DEFAULT 'manual'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_hora IS NULL OR p_hora < 0 OR p_hora > 23 THEN RAISE EXCEPTION 'hora_invalida'; END IF;
  IF p_qtd_produzida IS NULL OR p_qtd_produzida < 0 THEN RAISE EXCEPTION 'qtd_invalida'; END IF;
  IF coalesce(p_fonte,'manual') NOT IN ('manual','ponto','balanca') THEN RAISE EXCEPTION 'fonte_invalida'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_fluxo f WHERE f.id = p_fluxo_id AND f.company_id = p_company_id AND f.plant_id = p_plant_id) THEN RAISE EXCEPTION 'fluxo_nao_encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_produto p WHERE p.id = p_produto_id AND p.company_id = p_company_id AND p.plant_id = p_plant_id) THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  IF p_posto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prod_posto po WHERE po.id = p_posto_id AND po.company_id = p_company_id AND po.plant_id = p_plant_id) THEN RAISE EXCEPTION 'posto_nao_encontrado'; END IF;
  IF p_etapa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prod_fluxo_etapa e WHERE e.id = p_etapa_id AND e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.fluxo_id = p_fluxo_id) THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  IF p_tarefa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prod_tarefa t WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id) THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  INSERT INTO public.prod_apontamento_hora (company_id, plant_id, fluxo_id, etapa_id, tarefa_id, posto_id, produto_id, data, hora, qtd_produzida, unidade, pessoas_presentes, fonte, criado_por)
  VALUES (p_company_id, p_plant_id, p_fluxo_id, p_etapa_id, p_tarefa_id, p_posto_id, p_produto_id, p_data, p_hora, p_qtd_produzida, p_unidade, p_pessoas_presentes, coalesce(p_fonte,'manual'), auth.uid())
  ON CONFLICT (company_id, fluxo_id, posto_id, produto_id, data, hora) DO UPDATE SET
      etapa_id = EXCLUDED.etapa_id, tarefa_id = EXCLUDED.tarefa_id, qtd_produzida = EXCLUDED.qtd_produzida,
      unidade = EXCLUDED.unidade, pessoas_presentes = EXCLUDED.pessoas_presentes, fonte = EXCLUDED.fonte,
      excluido_em = NULL, excluido_por = NULL, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;
