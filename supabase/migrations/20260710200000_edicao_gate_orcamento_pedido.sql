-- ============================================================
-- Regra de edição (RD-25, CEO 10/07): orçamento edita até APROVAR,
-- pedido edita até FATURAR (NF emitida). Dois marcos imutáveis.
-- Conformidade fiscal Pilar 1: guarda de NF no BACKEND (defesa real,
-- não cosmética no front).
-- ============================================================

-- 1) ORÇAMENTO: rascunho/revisao/enviado/visualizado edita LIVRE;
--    aprovado/convertido = IMUTÁVEL (sem liberação — trava de vez).
CREATE OR REPLACE FUNCTION fn_orcamento_pode_editar(p_orcamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_company uuid; v_liberada boolean; v_pode boolean; v_motivo text;
BEGIN
  SELECT status, company_id, edicao_liberada INTO v_status, v_company, v_liberada
  FROM erp_orcamentos WHERE id=p_orcamento_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso a este orçamento'); END IF;

  IF v_status IN ('rascunho','revisao','enviado','visualizado') THEN
    v_pode:=true;  v_motivo:='Editável (antes da aprovação)';
  ELSIF v_status IN ('aprovado','convertido') THEN
    v_pode:=false; v_motivo:='Orçamento aprovado é imutável. Alterações agora são feitas no pedido.';
  ELSE
    v_pode:=false; v_motivo:='Orçamento '||v_status||' não pode ser editado';
  END IF;

  -- precisa_liberacao/pode_liberar mantidos por compatibilidade do front (agora sempre false:
  -- não há mais caminho de liberação — edita livre até aprovar, imutável depois).
  RETURN jsonb_build_object('ok',true,'pode_editar',v_pode,'precisa_liberacao',false,
    'edicao_liberada',COALESCE(v_liberada,false),'status',v_status,
    'pode_liberar',false,'motivo',v_motivo);
END; $$;

-- fn_orcamento_salvar_itens: alinhar a mesma regra (fecha backdoor de "liberada" no aprovado).
CREATE OR REPLACE FUNCTION fn_orcamento_salvar_itens(p_orcamento_id uuid, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_company uuid; v_pode boolean;
        v_item jsonb; v_count int:=0; v_total_antes numeric; v_total_depois numeric; v_nome text;
        v_qtd numeric; v_preco numeric; v_dpct numeric; v_dval numeric; v_sub numeric;
BEGIN
  SELECT status, company_id, total INTO v_status, v_company, v_total_antes
  FROM erp_orcamentos WHERE id=p_orcamento_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','Orçamento não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso'); END IF;

  v_pode := v_status IN ('rascunho','revisao','enviado','visualizado');
  IF NOT v_pode THEN
    RETURN jsonb_build_object('ok',false,'erro','Orçamento aprovado é imutável — a alteração agora é no pedido.'); END IF;

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
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id=auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id,company_id,evento,detalhe,usuario_id,usuario_nome,metadata)
  VALUES(p_orcamento_id,v_company,'itens_alterados',v_count||' item(ns) salvos',auth.uid(),v_nome,
    jsonb_build_object('total_antes',v_total_antes,'total_depois',v_total_depois,'itens',v_count));

  RETURN jsonb_build_object('ok',true,'itens',v_count,'total',v_total_depois);
END; $$;

-- fn_orcamento_liberar_edicao: sem uso agora (não há liberação). Torna inerte (fecha backdoor).
CREATE OR REPLACE FUNCTION fn_orcamento_liberar_edicao(p_orcamento_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN jsonb_build_object('ok',false,
    'erro','Liberação não se aplica: orçamento edita livre até aprovar e é imutável depois. Alterações pós-aprovação são no pedido.');
END; $$;

-- 2) Trilha de auditoria do PEDIDO (não existia). Espelha erp_orcamento_historico.
CREATE TABLE IF NOT EXISTS erp_pedido_historico (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id    uuid NOT NULL,
  company_id   uuid NOT NULL,
  evento       text NOT NULL,
  detalhe      text,
  usuario_id   uuid,
  usuario_nome text,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ind_pedido_historico_pedido ON erp_pedido_historico(pedido_id, created_at DESC);
ALTER TABLE erp_pedido_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pedido_hist_sel ON erp_pedido_historico;
CREATE POLICY pedido_hist_sel ON erp_pedido_historico FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 3) Gate de leitura do PEDIDO — NF é o marco imutável (não o status).
CREATE OR REPLACE FUNCTION fn_pedido_pode_editar(p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_company uuid; v_nf boolean; v_titulos boolean;
BEGIN
  SELECT status, company_id, COALESCE(nf_emitida,false), COALESCE(titulos_gerados,false)
    INTO v_status, v_company, v_nf, v_titulos
  FROM erp_pedidos WHERE id=p_pedido_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','Pedido não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso a este pedido'); END IF;

  IF v_nf THEN
    RETURN jsonb_build_object('ok',true,'pode_editar',false,'bloqueado_por_nf',true,
      'motivo','Pedido faturado (NF emitida). Para demandas extras, crie um novo pedido.'); END IF;
  IF v_status='cancelado' THEN
    RETURN jsonb_build_object('ok',true,'pode_editar',false,'bloqueado_por_nf',false,
      'motivo','Pedido cancelado não pode ser editado.'); END IF;

  RETURN jsonb_build_object('ok',true,'pode_editar',true,'bloqueado_por_nf',false,
    'titulos_gerados',v_titulos,
    'motivo',CASE WHEN v_titulos
      THEN 'Editável — atenção: títulos já gerados precisarão de revisão nas Contas a Receber.'
      ELSE 'Editável' END);
END; $$;

-- 4) Edição de itens do PEDIDO — defesa real no backend (SECURITY DEFINER).
--    Valida gate (bloqueia NF), regrava itens (trigger recalc_pedido_total cuida do total),
--    registra trilha, e SINALIZA se há títulos a revisar (não reescreve erp_receber — risco
--    de pagamento parcial; revisão explícita fica a cargo do operador).
CREATE OR REPLACE FUNCTION fn_pedido_editar_itens(p_pedido_id uuid, p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status text; v_company uuid; v_nf boolean; v_titulos boolean;
        v_item jsonb; v_count int:=0; v_total_antes numeric; v_total_depois numeric; v_nome text;
        v_qtd numeric; v_preco numeric; v_dpct numeric; v_dval numeric; v_sub numeric;
BEGIN
  SELECT status, company_id, COALESCE(nf_emitida,false), COALESCE(titulos_gerados,false), total
    INTO v_status, v_company, v_nf, v_titulos, v_total_antes
  FROM erp_pedidos WHERE id=p_pedido_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','Pedido não encontrado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) AND NOT is_admin() THEN
    RETURN jsonb_build_object('ok',false,'erro','Sem acesso'); END IF;
  IF v_nf THEN
    RETURN jsonb_build_object('ok',false,'bloqueado_por_nf',true,
      'erro','Pedido faturado (NF emitida) é imutável. Crie um novo pedido para a demanda extra.'); END IF;
  IF v_status='cancelado' THEN
    RETURN jsonb_build_object('ok',false,'erro','Pedido cancelado não pode ser editado.'); END IF;

  DELETE FROM erp_pedidos_itens WHERE pedido_id=p_pedido_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF COALESCE(NULLIF(trim(COALESCE(v_item->>'produto_nome', v_item->>'servico_descricao','')),''),'')='' THEN
      CONTINUE; -- linha sem descrição = ignorada
    END IF;
    v_qtd  := COALESCE((v_item->>'quantidade')::numeric,1);
    v_preco:= COALESCE((v_item->>'preco_unitario')::numeric,0);
    v_dpct := COALESCE((v_item->>'desconto_percentual')::numeric,0);
    v_dval := COALESCE((v_item->>'desconto_valor')::numeric,0);
    v_sub  := GREATEST((v_qtd*v_preco) - (v_qtd*v_preco*v_dpct/100) - v_dval, 0);
    INSERT INTO erp_pedidos_itens(
      pedido_id,company_id,ordem,tipo_item,servico_id,servico_codigo,servico_descricao,
      produto_id,produto_codigo,produto_nome,produto_descricao,unidade,quantidade,
      preco_unitario,preco_custo,desconto_percentual,desconto_valor,subtotal,observacoes)
    VALUES(
      p_pedido_id,v_company,v_count,COALESCE(v_item->>'tipo_item','produto'),
      NULLIF(v_item->>'servico_id','')::uuid,v_item->>'servico_codigo',v_item->>'servico_descricao',
      NULLIF(v_item->>'produto_id','')::uuid,v_item->>'produto_codigo',v_item->>'produto_nome',v_item->>'produto_descricao',
      COALESCE(v_item->>'unidade','UN'),v_qtd,v_preco,COALESCE((v_item->>'preco_custo')::numeric,0),
      v_dpct,v_dval,v_sub,v_item->>'observacoes');
    v_count:=v_count+1;
  END LOOP;

  SELECT total INTO v_total_depois FROM erp_pedidos WHERE id=p_pedido_id; -- trigger recalc_pedido_total ja atualizou
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id=auth.uid();
  INSERT INTO erp_pedido_historico(pedido_id,company_id,evento,detalhe,usuario_id,usuario_nome,metadata)
  VALUES(p_pedido_id,v_company,'itens_alterados',v_count||' item(ns) salvos',auth.uid(),v_nome,
    jsonb_build_object('total_antes',v_total_antes,'total_depois',v_total_depois,'itens',v_count,'titulos_gerados',v_titulos));

  RETURN jsonb_build_object('ok',true,'itens',v_count,'total',v_total_depois,
    'titulos_precisa_revisao',v_titulos);
END; $$;

GRANT EXECUTE ON FUNCTION fn_orcamento_pode_editar(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION fn_orcamento_salvar_itens(uuid,jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION fn_orcamento_liberar_edicao(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pedido_pode_editar(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION fn_pedido_editar_itens(uuid,jsonb)     TO authenticated;
