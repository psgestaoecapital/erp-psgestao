-- ===== ONDA 3.2: ENTRADA NO ESTOQUE + WRAPPER LANCAR =====

-- 0) Reforco multi-tenant no vincular (produto deve ser da empresa da nota)
CREATE OR REPLACE FUNCTION fn_nfe_item_vincular(p_item_id uuid, p_produto_id uuid, p_fixar_depara boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_cnpj text; v_company uuid; v_entra boolean;
BEGIN
  SELECT i.*, n.company_id AS n_company, regexp_replace(COALESCE(n.emitente_cnpj,''),'\D','','g') AS cnpj
    INTO r FROM erp_nfe_recebidas_itens i JOIN erp_nfe_recebidas n ON n.id=i.nfe_recebida_id
   WHERE i.id=p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','item nao encontrado'); END IF;
  IF NOT (r.n_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;
  v_company := r.n_company; v_cnpj := r.cnpj;
  -- NOVO: produto tem que ser da mesma empresa
  IF NOT EXISTS (SELECT 1 FROM erp_produtos WHERE id=p_produto_id AND company_id=v_company) THEN
    RETURN jsonb_build_object('ok',false,'erro','produto nao pertence a empresa da nota'); END IF;
  v_entra := fn_estoque_cfop_entra(v_company, r.cfop);

  UPDATE erp_nfe_recebidas_itens
     SET produto_id=p_produto_id, entra_estoque=v_entra, vinculo_origem='manual' WHERE id=p_item_id;

  IF p_fixar_depara AND v_cnpj <> '' THEN
    INSERT INTO erp_produto_depara_fornecedor
      (company_id, fornecedor_cnpj, codigo_fornecedor, produto_id, ncm, descricao_fornecedor, criado_por)
    VALUES (v_company, v_cnpj, r.codigo_produto, p_produto_id, r.ncm, r.descricao, auth.uid())
    ON CONFLICT (company_id, fornecedor_cnpj, codigo_fornecedor)
    DO UPDATE SET produto_id=EXCLUDED.produto_id, ncm=EXCLUDED.ncm, descricao_fornecedor=EXCLUDED.descricao_fornecedor;
  END IF;
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'produto_id',p_produto_id,'entra_estoque',v_entra,'depara_fixado',p_fixar_depara);
END $$;

-- 1) Dar entrada no estoque dos itens elegiveis (produto vinculado + CFOP entra + ainda nao movimentado)
CREATE OR REPLACE FUNCTION fn_nfe_recebida_dar_entrada_estoque(p_nfe_recebida_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v erp_nfe_recebidas%ROWTYPE; v_local uuid; r record; v_mov uuid;
  v_movidos int := 0; v_valor numeric := 0; v_pend_vinculo int := 0;
BEGIN
  SELECT * INTO v FROM erp_nfe_recebidas WHERE id=p_nfe_recebida_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','nota nao encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;

  v_local := fn_estoque_local_principal(v.company_id);

  SELECT count(*) INTO v_pend_vinculo FROM erp_nfe_recebidas_itens
   WHERE nfe_recebida_id=v.id AND COALESCE(entra_estoque,false)=true AND produto_id IS NULL;

  FOR r IN
    SELECT i.* FROM erp_nfe_recebidas_itens i
     WHERE i.nfe_recebida_id=v.id AND i.produto_id IS NOT NULL
       AND COALESCE(i.entra_estoque,false)=true AND COALESCE(i.estoque_movimentado,false)=false
       AND EXISTS (SELECT 1 FROM erp_produtos p WHERE p.id=i.produto_id AND p.company_id=v.company_id)
  LOOP
    v_mov := fn_movimentar_estoque(
      p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'entrada',
      p_quantidade := r.quantidade, p_custo_unitario := r.valor_unitario,
      p_motivo := 'Entrada NF-e compra',
      p_observacoes := 'NF-e '||COALESCE(v.numero,'')||' - '||COALESCE(v.emitente_razao,''),
      p_ref_tipo := 'nfe_recebida', p_ref_id := v.id, p_ref_numero := v.numero
    );
    UPDATE erp_nfe_recebidas_itens SET estoque_movimentado=true, movimentacao_id=v_mov WHERE id=r.id;
    v_movidos := v_movidos + 1;
    v_valor := v_valor + COALESCE(r.valor_unitario,0)*COALESCE(r.quantidade,0);
  END LOOP;

  UPDATE erp_nfe_recebidas SET
    estoque_status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=v.id AND COALESCE(entra_estoque,false)=true) THEN 'nao_aplicavel'
      WHEN EXISTS (SELECT 1 FROM erp_nfe_recebidas_itens WHERE nfe_recebida_id=v.id AND COALESCE(entra_estoque,false)=true AND COALESCE(estoque_movimentado,false)=false) THEN 'parcial'
      ELSE 'completo' END,
    estoque_dado_em = CASE WHEN v_movidos>0 THEN now() ELSE estoque_dado_em END,
    updated_at = now()
  WHERE id=v.id;

  RETURN jsonb_build_object('ok',true,'itens_movidos',v_movidos,'valor_entrada',v_valor,'pendentes_vinculo',v_pend_vinculo,'local_id',v_local);
END $$;

-- 2) Wrapper Lancar = conta a pagar (sempre) + entrada no estoque (itens elegiveis). NAO bloqueia se ha pendentes.
CREATE OR REPLACE FUNCTION fn_nfe_recebida_lancar(p_nfe_recebida_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pagar jsonb; v_estoque jsonb; v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_nfe_recebidas WHERE id=p_nfe_recebida_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nota nao encontrada'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem permissao'); END IF;
  v_pagar := fn_nfe_recebida_gerar_pagar(p_nfe_recebida_id);
  v_estoque := fn_nfe_recebida_dar_entrada_estoque(p_nfe_recebida_id);
  RETURN jsonb_build_object('ok',true,'pagar',v_pagar,'estoque',v_estoque);
END $$;

GRANT EXECUTE ON FUNCTION fn_nfe_item_vincular(uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_nfe_recebida_dar_entrada_estoque(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_nfe_recebida_lancar(uuid) TO authenticated;
