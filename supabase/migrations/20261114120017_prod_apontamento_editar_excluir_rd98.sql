-- Indústria · /dashboard/produtividade/apontamento — GAP3 do auditor (RD-98 p2 CRUD + p4 exclusão rastreável):
-- "apontamento errado (posto/hora/qtd) não pode ser corrigido nem removido na tela". Editar a QUANTIDADE já
-- funcionava (relançar o mesmo posto/produto/hora dá upsert); faltava EXCLUIR um lançamento errado (posto/hora
-- trocados) e vê-los um a um para corrigir. Entrega: lista de lançamentos do dia + EXCLUIR por lançamento
-- (soft-delete rastreável, nunca DELETE físico) + o relançar REVIVE um lançamento excluído do mesmo posto/hora.
--
-- ADITIVO e idempotente: 2 colunas novas (soft-delete), 1 função nova de leitura, 1 função nova de exclusão, e
-- CREATE OR REPLACE de 2 funções existentes com MUDANÇA MÍNIMA (filtrar o excluído / reviver no conflito),
-- preservando toda a assinatura e o resto do corpo (RD-97). Guarda de empresa/planta igual à das demais
-- (fn_prod_assert_planta + get_user_company_ids/is_admin). Nenhum dado de cliente é apagado fisicamente.

-- 1) Soft-delete rastreável na tabela de apontamento.
ALTER TABLE public.prod_apontamento_hora ADD COLUMN IF NOT EXISTS deleted_em  timestamptz;
ALTER TABLE public.prod_apontamento_hora ADD COLUMN IF NOT EXISTS deleted_por uuid;

-- 2) A grade de confronto passa a ignorar o que foi excluído (única mudança: AND a.deleted_em IS NULL).
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
      AND a.deleted_em IS NULL
    GROUP BY a.posto_id, po.numero, po.capacidade_hora, a.hora
  ) s;
  RETURN jsonb_build_object('ok', true, 'data', p_data, 'postos', v);
END $function$;

-- 3) Relançar REVIVE o lançamento excluído do mesmo posto/produto/hora (só acrescenta o reset ao DO UPDATE).
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
      deleted_em = NULL, deleted_por = NULL, updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 4) LISTAR os lançamentos do dia (individuais, por posto/produto/hora) para a tela mostrar Editar/Excluir.
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
      'id', a.id, 'posto_id', a.posto_id, 'posto_numero', po.numero, 'atividade', po.atividade,
      'produto_id', a.produto_id, 'produto_codigo', pr.codigo, 'produto_nome', pr.nome,
      'hora', a.hora, 'qtd_produzida', a.qtd_produzida, 'unidade', a.unidade,
      'pessoas_presentes', a.pessoas_presentes, 'fonte', a.fonte
    ) ORDER BY po.numero, a.hora, pr.codigo), '[]'::jsonb) INTO v
  FROM public.prod_apontamento_hora a
  LEFT JOIN public.prod_posto po ON po.id = a.posto_id
  LEFT JOIN public.prod_produto pr ON pr.id = a.produto_id
  WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data
    AND a.deleted_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'lancamentos', v);
END $function$;

-- 5) EXCLUIR um lançamento (soft-delete rastreável + audit).
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_a prod_apontamento_hora%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.prod_apontamento_hora WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_a.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  PERFORM public.fn_prod_assert_planta(v_a.company_id, v_a.plant_id);
  IF v_a.deleted_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluida', true); END IF;

  UPDATE public.prod_apontamento_hora SET deleted_em = now(), deleted_por = v_uid WHERE id = p_id;

  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_a.company_id, v_uid, (SELECT email FROM users WHERE id = v_uid), 'prod_apontamento_hora', p_id::text,
          'apontamento_excluir', to_jsonb(v_a),
          jsonb_build_object('deleted_em', now(), 'deleted_por', v_uid));

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_apontamento_listar(uuid, uuid, uuid, date) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_prod_apontamento_excluir(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontamento_listar(uuid, uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontamento_excluir(uuid) TO authenticated, service_role;

-- As 2 funções RE-DEFINIDAS (CREATE OR REPLACE) continuam travadas (o REPLACE preserva o ACL; re-aplicamos por
-- idempotência e para a guarda de CI reconhecer a trava nesta migration).
REVOKE ALL ON FUNCTION public.fn_prod_produtividade_hora(uuid, uuid, uuid, date) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_prod_apontar_hora(uuid, uuid, uuid, uuid, date, integer, numeric, uuid, uuid, uuid, text, integer, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_produtividade_hora(uuid, uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontar_hora(uuid, uuid, uuid, uuid, date, integer, numeric, uuid, uuid, uuid, text, integer, text) TO authenticated, service_role;

-- 6) RD-95: "?" das novas ações (editar/excluir) e da lista de lançamentos.
INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('prod.apont.lancamentos', '/dashboard/produtividade/apontamento', 'Lançamentos do dia',
  'Lista — não se preenche.', 'Mostra cada apontamento do dia (posto, produto, hora e quantidade) para você corrigir ou remover um lançamento errado.',
  'Posto 03 · Esfola · 08h · 320 kg.', 'O confronto acima soma os produtos por posto/hora; aqui você vê um a um.'),
 ('prod.apont.editar', '/dashboard/produtividade/apontamento', 'Editar lançamento',
  'Botão — não se preenche.', 'Leva o lançamento para o formulário acima já preenchido; ajuste a quantidade (ou o produto/hora) e lance de novo.',
  'Corrigir 320 → 280 kg.', 'Mudar o posto/hora cria um novo lançamento; o antigo continua até você excluí-lo.'),
 ('prod.apont.excluir', '/dashboard/produtividade/apontamento', 'Excluir lançamento',
  'Botão — não se preenche.', 'Remove um lançamento errado (ex.: posto ou hora trocados). A remoção fica registrada (quem e quando), não apaga o histórico.',
  'Excluir o apontamento lançado na hora errada.', 'Excluir não "zera" a produção do dia — ele tira só aquele lançamento específico.')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: a tela consome as RPCs novas (append idempotente).
UPDATE public.system_screens
SET rpcs_chamadas = (
  SELECT array_agg(DISTINCT e ORDER BY e)
  FROM unnest(COALESCE(rpcs_chamadas, '{}') || ARRAY['fn_prod_apontamento_listar','fn_prod_apontamento_excluir']) AS e)
WHERE rota = '/dashboard/produtividade/apontamento';
