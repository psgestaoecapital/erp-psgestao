-- ============================================================
-- #2 Jordana — Editar orcamento salvo com liberacao de gestor
-- Aditivo (RD-30). Regra: rascunho edita livre; enviado/visualizado/
-- aprovado travado (requer liberacao OWNER/MANAGER, vale 1 rodada);
-- convertido/cancelado/recusado/expirado/venda_avulsa = terminal.
-- ============================================================

ALTER TABLE erp_orcamentos
  ADD COLUMN IF NOT EXISTS edicao_liberada       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edicao_liberada_por    uuid,
  ADD COLUMN IF NOT EXISTS edicao_liberada_em     timestamptz,
  ADD COLUMN IF NOT EXISTS edicao_liberada_motivo text;

-- 1) Helper de leitura p/ o frontend decidir o que mostrar
CREATE OR REPLACE FUNCTION fn_orcamento_pode_editar(p_orcamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_company uuid; v_liberada boolean;
        v_pode boolean; v_precisa boolean; v_motivo text; v_papel_ok boolean;
BEGIN
  SELECT status, company_id, edicao_liberada
    INTO v_status, v_company, v_liberada
  FROM erp_orcamentos WHERE id=p_orcamento_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso a este orçamento'); END IF;

  v_papel_ok := is_admin() OR EXISTS (
    SELECT 1 FROM tenant_user_roles
    WHERE user_id=auth.uid() AND company_id=v_company
      AND role IN ('CLIENT_OWNER','CLIENT_MANAGER') AND is_active=true);

  IF v_status='rascunho' THEN
    v_pode:=true; v_precisa:=false; v_motivo:='Rascunho — edição livre';
  ELSIF v_status IN ('enviado','visualizado','aprovado') THEN
    v_precisa:=true; v_pode:=COALESCE(v_liberada,false);
    v_motivo:=CASE WHEN v_liberada THEN 'Edição liberada' ELSE 'Travado — requer liberação de um gestor' END;
  ELSE
    v_pode:=false; v_precisa:=false; v_motivo:='Orçamento '||v_status||' não pode ser editado';
  END IF;

  RETURN jsonb_build_object('ok',true,'pode_editar',v_pode,'precisa_liberacao',v_precisa,
    'edicao_liberada',COALESCE(v_liberada,false),'status',v_status,
    'pode_liberar',v_papel_ok,'motivo',v_motivo);
END; $$;

-- 2) Liberar edicao (so OWNER/MANAGER/admin)
CREATE OR REPLACE FUNCTION fn_orcamento_liberar_edicao(p_orcamento_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_company uuid; v_papel_ok boolean; v_nome text;
BEGIN
  SELECT status, company_id INTO v_status, v_company FROM erp_orcamentos WHERE id=p_orcamento_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso'); END IF;

  v_papel_ok := is_admin() OR EXISTS (
    SELECT 1 FROM tenant_user_roles WHERE user_id=auth.uid() AND company_id=v_company
      AND role IN ('CLIENT_OWNER','CLIENT_MANAGER') AND is_active=true);
  IF NOT v_papel_ok THEN
    RETURN jsonb_build_object('ok',false,'erro','Apenas gestor ou dono pode liberar a edição'); END IF;

  IF v_status NOT IN ('enviado','visualizado','aprovado') THEN
    RETURN jsonb_build_object('ok',false,'erro','Orçamento '||v_status||' não requer liberação'); END IF;

  UPDATE erp_orcamentos
  SET edicao_liberada=true, edicao_liberada_por=auth.uid(),
      edicao_liberada_em=now(), edicao_liberada_motivo=p_motivo
  WHERE id=p_orcamento_id;

  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id=auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id,company_id,evento,detalhe,usuario_id,usuario_nome,metadata)
  VALUES(p_orcamento_id,v_company,'edicao_liberada',
    COALESCE(p_motivo,'Edição liberada para revisão'),auth.uid(),v_nome,
    jsonb_build_object('status_no_momento',v_status));

  RETURN jsonb_build_object('ok',true,'mensagem','Edição liberada');
END; $$;

-- 3) Salvar itens (valida trava; consome liberacao; trigger recalc cuida do total)
CREATE OR REPLACE FUNCTION fn_orcamento_salvar_itens(p_orcamento_id uuid, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_company uuid; v_liberada boolean; v_pode boolean;
        v_item jsonb; v_count int:=0; v_total_antes numeric; v_total_depois numeric; v_nome text;
        v_qtd numeric; v_preco numeric; v_dpct numeric; v_dval numeric; v_sub numeric;
BEGIN
  SELECT status, company_id, edicao_liberada, total
    INTO v_status, v_company, v_liberada, v_total_antes
  FROM erp_orcamentos WHERE id=p_orcamento_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso'); END IF;

  IF v_status='rascunho' THEN v_pode:=true;
  ELSIF v_status IN ('enviado','visualizado','aprovado') THEN v_pode:=COALESCE(v_liberada,false);
  ELSE v_pode:=false; END IF;
  IF NOT v_pode THEN
    RETURN jsonb_build_object('ok',false,'erro','Orçamento travado — peça a liberação de um gestor antes de editar'); END IF;

  DELETE FROM erp_orcamentos_itens WHERE orcamento_id=p_orcamento_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_qtd  := COALESCE((v_item->>'quantidade')::numeric,1);
    v_preco:= COALESCE((v_item->>'preco_unitario')::numeric,0);
    v_dpct := COALESCE((v_item->>'desconto_percentual')::numeric,0);
    v_dval := COALESCE((v_item->>'desconto_valor')::numeric,0);
    v_sub  := GREATEST((v_qtd*v_preco) - (v_qtd*v_preco*v_dpct/100) - v_dval, 0);
    INSERT INTO erp_orcamentos_itens(
      orcamento_id,company_id,ordem,produto_id,produto_codigo,produto_nome,produto_descricao,
      unidade,quantidade,preco_unitario,preco_custo,desconto_percentual,desconto_valor,subtotal,
      observacoes,tipo_item,servico_id,servico_codigo,servico_descricao)
    VALUES(
      p_orcamento_id,v_company,v_count,
      NULLIF(v_item->>'produto_id','')::uuid,v_item->>'produto_codigo',v_item->>'produto_nome',v_item->>'produto_descricao',
      COALESCE(v_item->>'unidade','UN'),v_qtd,v_preco,COALESCE((v_item->>'preco_custo')::numeric,0),
      v_dpct,v_dval,v_sub,v_item->>'observacoes',COALESCE(v_item->>'tipo_item','produto'),
      NULLIF(v_item->>'servico_id','')::uuid,v_item->>'servico_codigo',v_item->>'servico_descricao');
    v_count:=v_count+1;
  END LOOP;

  SELECT total INTO v_total_depois FROM erp_orcamentos WHERE id=p_orcamento_id;

  IF v_status<>'rascunho' THEN
    UPDATE erp_orcamentos
    SET edicao_liberada=false, edicao_liberada_por=NULL, edicao_liberada_em=NULL, edicao_liberada_motivo=NULL
    WHERE id=p_orcamento_id;
  END IF;

  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id=auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id,company_id,evento,detalhe,usuario_id,usuario_nome,metadata)
  VALUES(p_orcamento_id,v_company,'itens_alterados',
    v_count||' item(ns) salvos',auth.uid(),v_nome,
    jsonb_build_object('total_antes',v_total_antes,'total_depois',v_total_depois,'itens',v_count));

  RETURN jsonb_build_object('ok',true,'itens',v_count,'total',v_total_depois);
END; $$;

GRANT EXECUTE ON FUNCTION fn_orcamento_pode_editar(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION fn_orcamento_liberar_edicao(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_orcamento_salvar_itens(uuid,jsonb)  TO authenticated;
