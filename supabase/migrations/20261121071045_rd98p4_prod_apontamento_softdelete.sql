-- RD-98 p4 (exclusão rastreável) — /dashboard/produtividade/apontamento
-- Gap do auditor (score 93): fn_prod_apontamento_excluir fazia DELETE FÍSICO em
-- prod_apontamento_hora. RD-98 exige soft-delete + listagem que filtra excluídos.
-- Aditiva: colunas novas (IF NOT EXISTS) + CREATE OR REPLACE das 4 funções de apontamento.
-- Mantém o registro em audit_log_global. A unicidade por (company,fluxo,posto,produto,data,hora)
-- é preservada: reapontar a mesma chave REVIVE a linha (excluido_em volta a NULL).

-- 1) Colunas de soft-delete (aditivas) ----------------------------------------
ALTER TABLE public.prod_apontamento_hora
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- Listagens do dia filtram por esta coluna; índice parcial ajuda a leitura por dia.
CREATE INDEX IF NOT EXISTS ix_prod_apont_dia_vivos
  ON public.prod_apontamento_hora (company_id, plant_id, fluxo_id, data)
  WHERE excluido_em IS NULL;

-- 2) Exclusão rastreável = soft-delete (não mais DELETE físico) ----------------
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_excluir(p_company_id uuid, p_plant_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.prod_apontamento_hora%ROWTYPE;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT * INTO v_row FROM public.prod_apontamento_hora
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id
     AND excluido_em IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior)
  VALUES (p_company_id, auth.uid(), 'prod_apontamento_hora', p_id::text, 'delete', to_jsonb(v_row));

  UPDATE public.prod_apontamento_hora
     SET excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id
     AND excluido_em IS NULL;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

-- 3) Listar só os vivos -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_listar(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

-- 4) Produtividade/hora só sobre os vivos -------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prod_produtividade_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(linha ORDER BY linha->>'posto_numero', (linha->>'hora')::int), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'posto_id', a.posto_id,
      'posto_numero', po.numero,
      'hora', a.hora,
      'produzido', SUM(a.qtd_produzida),
      'capacidade', po.capacidade_hora,
      'produtividade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                                ELSE round((SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1) END,
      'ociosidade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                             ELSE greatest(0, round((1 - SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1)) END,
      'pessoas_presentes', MAX(a.pessoas_presentes)
    ) AS linha
    FROM public.prod_apontamento_hora a
    LEFT JOIN public.prod_posto po ON po.id = a.posto_id
    WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data
      AND a.excluido_em IS NULL
    GROUP BY a.posto_id, po.numero, po.capacidade_hora, a.hora
  ) s;
  RETURN jsonb_build_object('ok', true, 'data', p_data, 'postos', v);
END $function$;

-- 5) Reapontar REVIVE a linha soft-deletada (idempotência da chave única) ------
CREATE OR REPLACE FUNCTION public.fn_prod_apontar_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_produto_id uuid, p_data date, p_hora integer, p_qtd_produzida numeric, p_posto_id uuid DEFAULT NULL::uuid, p_etapa_id uuid DEFAULT NULL::uuid, p_tarefa_id uuid DEFAULT NULL::uuid, p_unidade text DEFAULT NULL::text, p_pessoas_presentes integer DEFAULT NULL::integer, p_fonte text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_hora IS NULL OR p_hora < 0 OR p_hora > 23 THEN RAISE EXCEPTION 'hora_invalida'; END IF;
  IF p_qtd_produzida IS NULL OR p_qtd_produzida < 0 THEN RAISE EXCEPTION 'qtd_invalida'; END IF;
  IF coalesce(p_fonte,'manual') NOT IN ('manual','ponto','balanca') THEN RAISE EXCEPTION 'fonte_invalida'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_fluxo f WHERE f.id = p_fluxo_id AND f.company_id = p_company_id AND f.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'fluxo_nao_encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_produto p WHERE p.id = p_produto_id AND p.company_id = p_company_id AND p.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  -- Validar as FKs opcionais contra a mesma empresa/planta (e a etapa contra o fluxo) quando informadas,
  -- para não aceitar referência cruzada de outra empresa.
  IF p_posto_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_posto po WHERE po.id = p_posto_id AND po.company_id = p_company_id AND po.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'posto_nao_encontrado'; END IF;
  IF p_etapa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_fluxo_etapa e WHERE e.id = p_etapa_id AND e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.fluxo_id = p_fluxo_id)
  THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  IF p_tarefa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_tarefa t WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  INSERT INTO public.prod_apontamento_hora (company_id, plant_id, fluxo_id, etapa_id, tarefa_id, posto_id, produto_id,
      data, hora, qtd_produzida, unidade, pessoas_presentes, fonte, criado_por)
  VALUES (p_company_id, p_plant_id, p_fluxo_id, p_etapa_id, p_tarefa_id, p_posto_id, p_produto_id,
      p_data, p_hora, p_qtd_produzida, p_unidade, p_pessoas_presentes, coalesce(p_fonte,'manual'), auth.uid())
  ON CONFLICT (company_id, fluxo_id, posto_id, produto_id, data, hora) DO UPDATE SET
      etapa_id = EXCLUDED.etapa_id, tarefa_id = EXCLUDED.tarefa_id, qtd_produzida = EXCLUDED.qtd_produzida,
      unidade = EXCLUDED.unidade, pessoas_presentes = EXCLUDED.pessoas_presentes, fonte = EXCLUDED.fonte,
      excluido_em = NULL, excluido_por = NULL,
      updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
