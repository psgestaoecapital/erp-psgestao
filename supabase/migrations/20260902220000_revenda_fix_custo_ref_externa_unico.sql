-- Revenda · correção de raiz (RD-57/RD-38): fn_veic_custo_salvar ancorava o título de erp_pagar
-- no ref_externa_id = veiculo_id. Como existe UNIQUE parcial em
-- erp_pagar(company_id, ref_externa_sistema, ref_externa_id) WHERE ref_externa_id IS NOT NULL,
-- o SEGUNDO custo-com-título do MESMO veículo colidia (23505). Um veículo tem vários custos —
-- preparação, documentação, funilaria… — logo isso quebraria na prática, não no papel.
-- Prova: reproduzido em produção (dois custos com título no mesmo chassi → duplicate key).
-- Correção: o título ancora no id do CUSTO (único por custo). Grava o custo primeiro, depois o
-- título com ref = custo_id, e liga custo.pagar_id. Comportamento externo idêntico; só a chave muda.

CREATE OR REPLACE FUNCTION public.fn_veic_custo_salvar(
  p_veiculo_id uuid, p_custo jsonb, p_gerar_pagar boolean, p_vencimento date, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_modelo text; v_placa text; v_custo_id uuid; v_pagar_id uuid;
        v_cat text := p_custo->>'categoria'; v_valor numeric := (p_custo->>'valor')::numeric;
BEGIN
  SELECT company_id, modelo, placa INTO v_comp, v_modelo, v_placa FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_gerar_pagar AND p_vencimento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vencimento_obrigatorio_para_titulo'); END IF;

  -- custo primeiro (sem título ainda) — entra_base_fiscal fica NULL quando ausente (aguarda contador §3.2)
  INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, fornecedor_id,
      fornecedor_nome, data_custo, entra_base_fiscal, documento, observacao, created_by)
  VALUES (v_comp, p_veiculo_id, v_cat, p_custo->>'descricao', v_valor,
      NULLIF(p_custo->>'fornecedor_id','')::uuid, p_custo->>'fornecedor_nome',
      COALESCE((p_custo->>'data_custo')::date, CURRENT_DATE),
      CASE WHEN (p_custo->>'entra_base_fiscal') IS NOT NULL THEN (p_custo->>'entra_base_fiscal')::boolean ELSE NULL END,
      p_custo->>'documento', p_custo->>'observacao', p_user)
  RETURNING id INTO v_custo_id;

  -- título ancora no id do CUSTO (gancho único por custo, não por veículo)
  IF p_gerar_pagar THEN
    INSERT INTO erp_pagar (company_id, valor, descricao, data_vencimento, data_emissao, categoria,
                           fornecedor_id, fornecedor_nome, ref_externa_sistema, ref_externa_id)
    VALUES (v_comp, v_valor,
            v_cat || ' — ' || COALESCE(v_modelo, '') || ' ' || COALESCE(v_placa, ''),
            p_vencimento, COALESCE((p_custo->>'data_custo')::date, CURRENT_DATE), v_cat,
            NULLIF(p_custo->>'fornecedor_id','')::uuid, p_custo->>'fornecedor_nome',
            'revenda_veiculos', v_custo_id::text)
    RETURNING id INTO v_pagar_id;
    UPDATE veic_custo SET pagar_id = v_pagar_id WHERE id = v_custo_id;
  END IF;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_comp, p_veiculo_id, 'custo', 'Custo: ' || v_cat || ' R$ ' || v_valor::text, p_user,
          jsonb_build_object('categoria', v_cat, 'valor', v_valor, 'pagar_id', v_pagar_id));

  RETURN jsonb_build_object('ok', true, 'custo_id', v_custo_id, 'pagar_id', v_pagar_id);
END $function$;
