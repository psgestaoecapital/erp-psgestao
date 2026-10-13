-- RD-41 · Hub de Projetos — elo orçamento↔BDI. Guarda o BDI aplicado no item de serviço de engenharia
-- e faz a RPC de salvar itens persistir bdi_percentual + margem_percentual (hoje não persiste).
-- RD-26: aditivo (coluna nova + colunas extras no INSERT existente); nada removido — os 7 itens de serviço
-- em produção continuam funcionando (colunas nullable). O cálculo do BDI segue na v_projetos_bdi_impacto.

ALTER TABLE public.erp_orcamentos_itens
  ADD COLUMN IF NOT EXISTS bdi_percentual numeric;

COMMENT ON COLUMN public.erp_orcamentos_itens.bdi_percentual IS
  'BDI (%) aplicado neste item de serviço de engenharia: preco_unitario = preco_custo × (1 + bdi/100). '
  'Origem: v_projetos_bdi_impacto (padrão do catálogo), ajustável por orçamento.';

CREATE OR REPLACE FUNCTION public.fn_orcamento_salvar_itens(p_orcamento_id uuid, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      observacoes,tipo_item,servico_id,servico_codigo,servico_descricao,
      margem_percentual,bdi_percentual)                                    -- << aditivo (BDI/margem)
    VALUES(
      p_orcamento_id,v_company,v_count,
      NULLIF(v_item->>'produto_id','')::uuid,v_item->>'produto_codigo',v_item->>'produto_nome',v_item->>'produto_descricao',
      COALESCE(v_item->>'unidade','UN'),v_qtd,v_preco,COALESCE((v_item->>'preco_custo')::numeric,0),
      v_dpct,v_dval,v_sub,v_item->>'observacoes',COALESCE(v_item->>'tipo_item','produto'),
      NULLIF(v_item->>'servico_id','')::uuid,v_item->>'servico_codigo',v_item->>'servico_descricao',
      NULLIF(v_item->>'margem_percentual','')::numeric, NULLIF(v_item->>'bdi_percentual','')::numeric);
    v_count:=v_count+1;
  END LOOP;
  SELECT total INTO v_total_depois FROM erp_orcamentos WHERE id=p_orcamento_id;
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_nome FROM auth.users WHERE id=auth.uid();
  INSERT INTO erp_orcamento_historico(orcamento_id,company_id,evento,detalhe,usuario_id,usuario_nome,metadata)
  VALUES(p_orcamento_id,v_company,'itens_alterados',v_count||' item(ns) salvos',auth.uid(),v_nome,
    jsonb_build_object('total_antes',v_total_antes,'total_depois',v_total_depois,'itens',v_count));
  RETURN jsonb_build_object('ok',true,'itens',v_count,'total',v_total_depois);
END; $function$;
