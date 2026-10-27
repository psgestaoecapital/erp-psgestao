-- HB2 Fatia 1 (Eng. Chefe 13/10): CRUD dos itens do orçamento SOBRE erp_orcamentos_itens (sem tabela nova).
-- Regras: guarda de empresa; só edita em rascunho/revisao/enviado/visualizado; bloqueia com escopo_congelado_em;
-- subtotal do item calculado aqui; subtotal/total do cabeçalho recalculados pelo trigger trg_recalc_orcamento;
-- auditoria em erp_orcamento_historico; REVOKE anon. Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.fn_orcamento_item_guarda(p_orcamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_status text; v_company uuid; v_cong timestamptz;
BEGIN
  SELECT status, company_id, escopo_congelado_em INTO v_status, v_company, v_cong
  FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este orçamento'); END IF;
  IF v_cong IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Escopo congelado em ' || to_char(v_cong AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ': os itens não podem mais ser alterados. Alterações entram como mudança de escopo.'); END IF;
  IF v_status NOT IN ('rascunho','revisao','enviado','visualizado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento ' || COALESCE(v_status,'sem status') || ' não pode ter itens alterados.'); END IF;
  RETURN jsonb_build_object('ok', true, 'company_id', v_company);
END; $f$;

CREATE OR REPLACE FUNCTION public.fn_orcamento_item_listar(p_orcamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_company uuid; v_cong timestamptz; v_status text; v_itens jsonb; v_sub numeric; v_total numeric;
BEGIN
  SELECT company_id, escopo_congelado_em, status, subtotal, total INTO v_company, v_cong, v_status, v_sub, v_total
  FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a este orçamento'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.ordem, i.created_at), '[]'::jsonb) INTO v_itens
  FROM erp_orcamentos_itens i WHERE i.orcamento_id = p_orcamento_id;
  RETURN jsonb_build_object('ok', true, 'itens', v_itens, 'subtotal', v_sub, 'total', v_total, 'status', v_status,
    'congelado', v_cong IS NOT NULL, 'editavel', v_cong IS NULL AND v_status IN ('rascunho','revisao','enviado','visualizado'));
END; $f$;

CREATE OR REPLACE FUNCTION public.fn_orcamento_item_adicionar(p_orcamento_id uuid, p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE g jsonb; v_company uuid; v_qtd numeric; v_preco numeric; v_dpct numeric; v_dval numeric; v_sub numeric;
        v_tipo text; v_nome text; v_id uuid; v_total numeric; v_ordem int; v_desc text;
BEGIN
  g := fn_orcamento_item_guarda(p_orcamento_id);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  v_company := (g->>'company_id')::uuid;
  PERFORM public.fn__guarda_empresa(v_company);
  v_desc := NULLIF(btrim(COALESCE(p_item->>'produto_nome', p_item->>'servico_descricao', '')), '');
  IF v_desc IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe a descrição do item.'); END IF;
  v_qtd := COALESCE(NULLIF(p_item->>'quantidade','')::numeric, 1);
  v_preco := COALESCE(NULLIF(p_item->>'preco_unitario','')::numeric, 0);
  v_dpct := COALESCE(NULLIF(p_item->>'desconto_percentual','')::numeric, 0);
  v_dval := COALESCE(NULLIF(p_item->>'desconto_valor','')::numeric, 0);
  IF v_qtd <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'A quantidade deve ser maior que zero.'); END IF;
  IF v_preco < 0 OR v_dpct < 0 OR v_dpct > 100 OR v_dval < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Preço e descontos inválidos (desconto de 0 a 100%).'); END IF;
  v_tipo := COALESCE(NULLIF(p_item->>'tipo_item',''), 'produto');
  IF v_tipo NOT IN ('produto','servico') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Tipo do item deve ser produto ou serviço.'); END IF;
  v_sub := GREATEST(v_qtd*v_preco - v_qtd*v_preco*v_dpct/100 - v_dval, 0);
  SELECT COALESCE(MAX(ordem), -1) + 1 INTO v_ordem FROM erp_orcamentos_itens WHERE orcamento_id = p_orcamento_id;
  INSERT INTO erp_orcamentos_itens(orcamento_id, company_id, ordem, produto_id, produto_codigo, produto_nome, produto_descricao,
      unidade, quantidade, preco_unitario, preco_custo, desconto_percentual, desconto_valor, subtotal, observacoes, tipo_item)
  VALUES (p_orcamento_id, v_company, v_ordem, NULLIF(p_item->>'produto_id','')::uuid, p_item->>'produto_codigo', v_desc,
      p_item->>'produto_descricao', COALESCE(NULLIF(p_item->>'unidade',''),'UN'), v_qtd, v_preco,
      COALESCE(NULLIF(p_item->>'preco_custo','')::numeric, 0), v_dpct, v_dval, v_sub, p_item->>'observacoes', v_tipo)
  RETURNING id INTO v_id;
  SELECT total INTO v_total FROM erp_orcamentos WHERE id = p_orcamento_id;
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id = auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id, company_id, evento, detalhe, usuario_id, usuario_nome, metadata)
  VALUES (p_orcamento_id, v_company, 'item_adicionado', v_desc, auth.uid(), v_nome,
          jsonb_build_object('item_id', v_id, 'subtotal_item', v_sub, 'total_depois', v_total));
  RETURN jsonb_build_object('ok', true, 'item_id', v_id, 'subtotal_item', v_sub, 'total', v_total);
END; $f$;

CREATE OR REPLACE FUNCTION public.fn_orcamento_item_editar(p_item_id uuid, p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r erp_orcamentos_itens%ROWTYPE; g jsonb; v_qtd numeric; v_preco numeric; v_dpct numeric; v_dval numeric; v_sub numeric;
        v_desc text; v_total numeric; v_nome text;
BEGIN
  SELECT * INTO r FROM erp_orcamentos_itens WHERE id = p_item_id;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item não encontrado'); END IF;
  g := fn_orcamento_item_guarda(r.orcamento_id);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  PERFORM public.fn__guarda_empresa(r.company_id);
  v_desc := NULLIF(btrim(COALESCE(p_item->>'produto_nome', r.produto_nome, '')), '');
  IF v_desc IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe a descrição do item.'); END IF;
  v_qtd := COALESCE(NULLIF(p_item->>'quantidade','')::numeric, r.quantidade);
  v_preco := COALESCE(NULLIF(p_item->>'preco_unitario','')::numeric, r.preco_unitario);
  v_dpct := COALESCE(NULLIF(p_item->>'desconto_percentual','')::numeric, r.desconto_percentual, 0);
  v_dval := COALESCE(NULLIF(p_item->>'desconto_valor','')::numeric, r.desconto_valor, 0);
  IF v_qtd <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'A quantidade deve ser maior que zero.'); END IF;
  IF v_preco < 0 OR v_dpct < 0 OR v_dpct > 100 OR v_dval < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Preço e descontos inválidos (desconto de 0 a 100%).'); END IF;
  v_sub := GREATEST(v_qtd*v_preco - v_qtd*v_preco*v_dpct/100 - v_dval, 0);
  UPDATE erp_orcamentos_itens SET produto_nome = v_desc,
      produto_descricao = COALESCE(p_item->>'produto_descricao', produto_descricao),
      unidade = COALESCE(NULLIF(p_item->>'unidade',''), unidade), quantidade = v_qtd, preco_unitario = v_preco,
      preco_custo = COALESCE(NULLIF(p_item->>'preco_custo','')::numeric, preco_custo),
      desconto_percentual = v_dpct, desconto_valor = v_dval, subtotal = v_sub,
      observacoes = COALESCE(p_item->>'observacoes', observacoes)
  WHERE id = p_item_id;
  SELECT total INTO v_total FROM erp_orcamentos WHERE id = r.orcamento_id;
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id = auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id, company_id, evento, detalhe, usuario_id, usuario_nome, metadata)
  VALUES (r.orcamento_id, r.company_id, 'item_editado', v_desc, auth.uid(), v_nome,
          jsonb_build_object('item_id', p_item_id, 'subtotal_antes', r.subtotal, 'subtotal_depois', v_sub, 'total_depois', v_total));
  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id, 'subtotal_item', v_sub, 'total', v_total);
END; $f$;

CREATE OR REPLACE FUNCTION public.fn_orcamento_item_excluir(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r erp_orcamentos_itens%ROWTYPE; g jsonb; v_total numeric; v_nome text;
BEGIN
  SELECT * INTO r FROM erp_orcamentos_itens WHERE id = p_item_id;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item não encontrado'); END IF;
  g := fn_orcamento_item_guarda(r.orcamento_id);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  PERFORM public.fn__guarda_empresa(r.company_id);
  DELETE FROM erp_orcamentos_itens WHERE id = p_item_id;
  SELECT total INTO v_total FROM erp_orcamentos WHERE id = r.orcamento_id;
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id = auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id, company_id, evento, detalhe, usuario_id, usuario_nome, metadata)
  VALUES (r.orcamento_id, r.company_id, 'item_excluido', COALESCE(r.produto_nome,''), auth.uid(), v_nome,
          jsonb_build_object('item_id', p_item_id, 'subtotal_item', r.subtotal, 'total_depois', v_total));
  RETURN jsonb_build_object('ok', true, 'total', v_total);
END; $f$;

REVOKE ALL ON FUNCTION public.fn_orcamento_item_guarda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_item_guarda(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_orcamento_item_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_item_listar(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_orcamento_item_adicionar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_item_adicionar(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_orcamento_item_editar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_item_editar(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_orcamento_item_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_item_excluir(uuid) TO authenticated, service_role;
