-- Modal Vender Animal: venda de gado com valor peso x R$/un (kg ou @), comprador
-- do cadastro (ou inline) e lancamento em Contas a Receber. Reusa erp_pec_movimentacao,
-- erp_clientes, erp_receber. erp_receber NAO tem coluna moeda (valor na moeda da empresa).
-- Aplicada via MCP em 2026-07-08. Dry-run validado (450kg x 15 = 6750, inserts OK).

ALTER TABLE erp_pec_movimentacao ADD COLUMN IF NOT EXISTS contraparte_id uuid REFERENCES erp_clientes(id);

CREATE OR REPLACE FUNCTION fn_cliente_criar_inline(p_company_id uuid, p_nome text, p_cpf_cnpj text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  IF COALESCE(trim(p_nome),'') = '' THEN RAISE EXCEPTION 'Nome do comprador obrigatorio'; END IF;
  INSERT INTO erp_clientes (company_id, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, ativo)
  VALUES (p_company_id, trim(p_nome), trim(p_nome), NULLIF(trim(p_cpf_cnpj),''), NULLIF(trim(p_cpf_cnpj),''), true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_cliente_criar_inline(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION fn_pec_animal_vender(
  p_company_id      uuid,
  p_animal_ids      uuid[],
  p_propriedade_id  uuid,
  p_comprador_id    uuid    DEFAULT NULL,
  p_comprador_nome  text    DEFAULT NULL,
  p_peso_kg         numeric DEFAULT NULL,
  p_valor_unitario  numeric DEFAULT NULL,
  p_unidade         text    DEFAULT 'kg',      -- 'kg' | 'arroba'
  p_valor_total     numeric DEFAULT NULL,
  p_vencimento      date    DEFAULT NULL,
  p_gerar_financeiro boolean DEFAULT true
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_n int; v_total numeric; v_por_animal numeric; v_peso_animal numeric;
  v_comprador_nome text; v_mov_ids uuid[] := '{}'; v_mid uuid; v_receber_id uuid;
  v_aid uuid; v_data date := CURRENT_DATE;
  ARROBA_KG constant numeric := 15;  -- 15kg = 1@ (CONFIRMAR convencao Paraguai/peso vivo)
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids())) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;
  v_n := COALESCE(array_length(p_animal_ids,1),0);
  IF v_n = 0 THEN RAISE EXCEPTION 'Nenhum animal informado'; END IF;

  v_comprador_nome := COALESCE(
    (SELECT nome_fantasia FROM erp_clientes WHERE id=p_comprador_id AND company_id=p_company_id),
    NULLIF(trim(p_comprador_nome),'')
  );

  v_total := COALESCE(
    p_valor_total,
    CASE WHEN p_peso_kg IS NOT NULL AND p_valor_unitario IS NOT NULL THEN
      CASE WHEN p_unidade='arroba' THEN (p_peso_kg / ARROBA_KG) * p_valor_unitario
           ELSE p_peso_kg * p_valor_unitario END
    END,
    0
  );
  v_por_animal := round(v_total / v_n, 2);
  v_peso_animal := CASE WHEN p_peso_kg IS NOT NULL THEN round(p_peso_kg / v_n, 2) ELSE NULL END;

  FOREACH v_aid IN ARRAY p_animal_ids LOOP
    INSERT INTO erp_pec_movimentacao (company_id, propriedade_id, animal_id, tipo, data, quantidade,
      peso_kg, valor, contraparte_id, contraparte_nome, criado_por)
    VALUES (p_company_id, p_propriedade_id, v_aid, 'venda', v_data, 1,
      v_peso_animal, v_por_animal, p_comprador_id, v_comprador_nome, auth.uid())
    RETURNING id INTO v_mid;
    v_mov_ids := v_mov_ids || v_mid;
    UPDATE erp_pec_animal SET status='vendido', ativo=false, data_saida=v_data, motivo_saida='venda',
      contraparte_nome=v_comprador_nome
    WHERE id=v_aid AND company_id=p_company_id;
  END LOOP;

  IF p_gerar_financeiro AND v_total > 0 AND (p_comprador_id IS NOT NULL OR v_comprador_nome IS NOT NULL) THEN
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, descricao, categoria, valor,
      data_vencimento, status, ref_externa_sistema, ref_externa_id)
    VALUES (p_company_id, p_comprador_id, v_comprador_nome,
      'Venda de ' || v_n || ' animal(is) - Pecuária', 'Venda de gado', v_total,
      COALESCE(p_vencimento, v_data), 'aberto', 'pecuaria', v_mov_ids[1]::text)
    RETURNING id INTO v_receber_id;
  END IF;

  RETURN json_build_object('movimentacao_ids', v_mov_ids, 'valor_total', v_total, 'receber_id', v_receber_id, 'qtd', v_n);
END $$;
GRANT EXECUTE ON FUNCTION fn_pec_animal_vender(uuid,uuid[],uuid,uuid,text,numeric,numeric,text,numeric,date,boolean) TO authenticated;
