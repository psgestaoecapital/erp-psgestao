-- Revenda · guardas de servidor nos formulários (bug de produção Alliance, 04/09/2026)
-- Erro cru "null value in column valor of relation veic_custo" chegou na tela do cliente:
-- fn_veic_custo_salvar fazia (p_custo->>'valor')::numeric e inseria SEM guarda. Valor null
-- (NaN→null no JSON) virava INSERT null → erro cru; valor não-numérico estourava no próprio cast.
-- Mesmo achado do fn_crm_oportunidade_criar do Hub: sem guarda de servidor. Corrige os 4 forms.
-- Retorno { ok:false, erro:<codigo>, campo:<input> } — códigos que o catálogo MENSAGEM_ERRO fala.

-- ============================================================================
-- CUSTO — o form que estourou. Parse seguro do valor + valor>0 + categoria + descrição.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_veic_custo_salvar(p_veiculo_id uuid, p_custo jsonb, p_gerar_pagar boolean, p_vencimento date, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_modelo text; v_placa text; v_custo_id uuid; v_pagar_id uuid;
        v_cat text := NULLIF(btrim(p_custo->>'categoria'),''); v_desc text := NULLIF(btrim(p_custo->>'descricao'),''); v_valor numeric;
BEGIN
  SELECT company_id, modelo, placa INTO v_comp, v_modelo, v_placa FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- parse seguro: valor inválido/não-numérico nunca chega ao banco (defesa em profundidade)
  BEGIN v_valor := NULLIF(btrim(p_custo->>'valor'),'')::numeric; EXCEPTION WHEN others THEN v_valor := NULL; END;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'valor'); END IF;
  IF v_cat IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'categoria_obrigatoria', 'campo', 'categoria'); END IF;
  IF v_desc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'descricao_obrigatoria', 'campo', 'descricao'); END IF;
  IF p_gerar_pagar AND p_vencimento IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vencimento_obrigatorio_para_titulo', 'campo', 'vencimento'); END IF;

  INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, fornecedor_id,
      fornecedor_nome, data_custo, entra_base_fiscal, documento, observacao, created_by)
  VALUES (v_comp, p_veiculo_id, v_cat, v_desc, v_valor,
      NULLIF(p_custo->>'fornecedor_id','')::uuid, p_custo->>'fornecedor_nome',
      COALESCE((p_custo->>'data_custo')::date, CURRENT_DATE),
      CASE WHEN (p_custo->>'entra_base_fiscal') IS NOT NULL THEN (p_custo->>'entra_base_fiscal')::boolean ELSE NULL END,
      p_custo->>'documento', p_custo->>'observacao', p_user)
  RETURNING id INTO v_custo_id;

  IF p_gerar_pagar THEN
    INSERT INTO erp_pagar (company_id, valor, descricao, data_vencimento, data_emissao, categoria,
                           fornecedor_id, fornecedor_nome, ref_externa_sistema, ref_externa_id)
    VALUES (v_comp, v_valor, v_cat || ' — ' || COALESCE(v_modelo, '') || ' ' || COALESCE(v_placa, ''),
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

-- ============================================================================
-- RESERVA — cliente obrigatório; "gerar recebível" exige sinal > 0 (senão falhava em silêncio).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_veic_reserva_criar(p_company_id uuid, p_veiculo_id uuid, p_reserva jsonb, p_gerar_receber boolean, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_sit text; v_res uuid; v_receber uuid; v_sinal numeric; v_cli text := NULLIF(btrim(p_reserva->>'cliente_nome'),'');
BEGIN
  SELECT company_id, situacao INTO v_comp, v_sit FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit IN ('vendido','entregue') THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_ja_vendido'); END IF;
  IF EXISTS (SELECT 1 FROM veic_reserva WHERE veiculo_id = p_veiculo_id AND situacao = 'ativa' AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'ja_reservado'); END IF;

  IF v_cli IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_obrigatorio', 'campo', 'cliente_nome'); END IF;
  BEGIN v_sinal := NULLIF(btrim(p_reserva->>'valor_sinal'),'')::numeric; EXCEPTION WHEN others THEN v_sinal := NULL; END;
  IF p_gerar_receber AND COALESCE(v_sinal,0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sinal_invalido_para_titulo', 'campo', 'valor_sinal'); END IF;

  INSERT INTO veic_reserva (company_id, veiculo_id, proposta_id, cliente_id, cliente_nome,
      valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, NULLIF(p_reserva->>'proposta_id','')::uuid,
      NULLIF(p_reserva->>'cliente_id','')::uuid, v_cli,
      v_sinal, p_reserva->>'forma_sinal', NULLIF(p_reserva->>'reservado_ate','')::date, 'ativa', p_user)
  RETURNING id INTO v_res;

  IF p_gerar_receber AND COALESCE(v_sinal,0) > 0 THEN
    v_receber := fn_veic__receber(p_company_id, v_res, 'Sinal de reserva — ' || v_cli, v_sinal,
      NULLIF(p_reserva->>'reservado_ate','')::date, NULLIF(p_reserva->>'cliente_id','')::uuid,
      v_cli, p_reserva->>'forma_sinal', NULL);
    UPDATE veic_reserva SET receber_id = v_receber WHERE id = v_res;
  END IF;

  PERFORM fn_veic_mudar_situacao(p_veiculo_id, 'reservado', p_user, 'Reservado para ' || v_cli);
  RETURN jsonb_build_object('ok', true, 'id', v_res, 'receber_id', v_receber);
END $function$;

-- ============================================================================
-- VENDA — cliente obrigatório; valor da venda > 0 (parse seguro).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_veic_venda_registrar(p_company_id uuid, p_veiculo_id uuid, p_venda jsonb, p_recebimentos jsonb, p_troca jsonb, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_sit text; v_modelo text; v_venda uuid; v_prop uuid := NULLIF(p_venda->>'proposta_id','')::uuid;
  v_troca_veic uuid; v_desc numeric := 0; v_troca_val numeric; v_aval numeric; v_troca_chassi text;
  v_rec jsonb; v_rec_id uuid; v_receber uuid; n_titulos int := 0; v_cli_nome text := NULLIF(btrim(p_venda->>'cliente_nome'),''); v_valor_venda numeric;
BEGIN
  SELECT company_id, situacao, modelo INTO v_comp, v_sit, v_modelo FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) OR v_comp <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit IN ('vendido','entregue','devolvido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_indisponivel', 'situacao', v_sit); END IF;

  IF v_cli_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_obrigatorio', 'campo', 'cliente_nome'); END IF;
  BEGIN v_valor_venda := NULLIF(btrim(p_venda->>'valor_venda'),'')::numeric; EXCEPTION WHEN others THEN v_valor_venda := NULL; END;
  IF v_valor_venda IS NULL OR v_valor_venda <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_venda_invalido', 'campo', 'valor_venda'); END IF;

  IF p_troca IS NOT NULL AND jsonb_typeof(p_troca) = 'object' AND p_troca <> '{}'::jsonb THEN
    v_troca_val := (p_troca->>'valor_troca')::numeric;
    v_aval := (p_troca->>'valor_avaliacao')::numeric;
    v_desc := COALESCE(v_troca_val,0) - COALESCE(v_aval,0);
    v_troca_chassi := NULLIF(p_troca->>'chassi','');
  END IF;

  INSERT INTO veic_venda (company_id, veiculo_id, proposta_id, cliente_id, cliente_nome, cliente_doc,
      data_venda, valor_venda, desconto_embutido_troca, valor_entrada, valor_financiado, banco_nome,
      retorno_banco, vendedor_nome, observacao, situacao, created_by)
  VALUES (p_company_id, p_veiculo_id, v_prop, NULLIF(p_venda->>'cliente_id','')::uuid, v_cli_nome,
      p_venda->>'cliente_doc', COALESCE((p_venda->>'data_venda')::date, CURRENT_DATE),
      v_valor_venda, NULLIF(v_desc,0), (p_venda->>'valor_entrada')::numeric,
      (p_venda->>'valor_financiado')::numeric, p_venda->>'banco_nome', (p_venda->>'retorno_banco')::numeric,
      p_venda->>'vendedor_nome', p_venda->>'observacao', 'aberta', p_user)
  RETURNING id INTO v_venda;

  IF p_recebimentos IS NOT NULL AND jsonb_typeof(p_recebimentos) = 'array' THEN
    FOR v_rec IN SELECT * FROM jsonb_array_elements(p_recebimentos) LOOP
      INSERT INTO veic_venda_recebimento (company_id, venda_id, tipo, devedor, valor, data_prevista,
          forma_pagamento, conta_bancaria_id)
      VALUES (p_company_id, v_venda, COALESCE(v_rec->>'tipo','parcela'), COALESCE(v_rec->>'devedor','cliente'),
          (v_rec->>'valor')::numeric, NULLIF(v_rec->>'data_prevista','')::date, v_rec->>'forma_pagamento',
          NULLIF(v_rec->>'conta_bancaria_id','')::uuid)
      RETURNING id INTO v_rec_id;
      v_receber := fn_veic__receber(p_company_id, v_rec_id,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco'
             THEN 'Repasse banco — ' || COALESCE(p_venda->>'banco_nome','') || ' — ' || COALESCE(v_modelo,'')
             ELSE (COALESCE(v_rec->>'tipo','parcela') || ' — ' || COALESCE(v_modelo,'') || ' — ' || COALESCE(v_cli_nome,'')) END,
        (v_rec->>'valor')::numeric, NULLIF(v_rec->>'data_prevista','')::date,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco' THEN NULL ELSE NULLIF(p_venda->>'cliente_id','')::uuid END,
        CASE WHEN COALESCE(v_rec->>'devedor','cliente') = 'banco' THEN p_venda->>'banco_nome' ELSE v_cli_nome END,
        v_rec->>'forma_pagamento', NULLIF(v_rec->>'conta_bancaria_id','')::uuid);
      UPDATE veic_venda_recebimento SET receber_id = v_receber WHERE id = v_rec_id;
      n_titulos := n_titulos + 1;
    END LOOP;
  END IF;

  IF v_troca_chassi IS NOT NULL THEN
    INSERT INTO veic_veiculo (company_id, chassi, placa, marca, modelo, ano_fabricacao, ano_modelo,
        km_entrada, km_atual, origem, valor_aquisicao, created_by, updated_by)
    VALUES (p_company_id, v_troca_chassi, NULLIF(p_troca->>'placa',''), p_troca->>'marca', p_troca->>'modelo',
        (p_troca->>'ano_fabricacao')::int, (p_troca->>'ano_modelo')::int, (p_troca->>'km')::numeric,
        (p_troca->>'km')::numeric, 'troca', v_aval, p_user, p_user)
    RETURNING id INTO v_troca_veic;
    INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, usuario_id, payload)
    VALUES (p_company_id, v_troca_veic, 'entrada',
        'Recebido em troca (venda) — avaliado em R$ ' || COALESCE(v_aval,0)::text, p_user,
        jsonb_build_object('origem','troca','valor_troca',v_troca_val,'valor_avaliacao',v_aval,'venda_id',v_venda));
    IF v_prop IS NOT NULL THEN
      UPDATE veic_proposta_troca SET veiculo_id = v_troca_veic WHERE proposta_id = v_prop AND veiculo_id IS NULL;
    END IF;
  END IF;

  PERFORM fn_veic_mudar_situacao(p_veiculo_id, 'vendido', p_user, 'Venda registrada');
  IF v_prop IS NOT NULL THEN UPDATE veic_proposta SET situacao = 'aceita' WHERE id = v_prop AND situacao NOT IN ('cancelada','recusada'); END IF;
  UPDATE veic_reserva SET situacao = 'convertida' WHERE veiculo_id = p_veiculo_id AND situacao = 'ativa' AND deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'id', v_venda, 'desconto_embutido_troca', NULLIF(v_desc,0),
      'troca_veiculo_id', v_troca_veic, 'n_titulos', n_titulos);
END $function$;

-- ============================================================================
-- FOTO — storage_path obrigatório (defesa; o upload já o define).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_veic_foto_registrar(p_veiculo_id uuid, p_storage_path text, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid; v_qtd int; v_ordem int;
BEGIN
  v_company := public.fn_veic_acesso(p_veiculo_id);
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF NULLIF(btrim(p_storage_path),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'storage_path_obrigatorio'); END IF;
  SELECT count(*), COALESCE(max(ordem)+1,0) INTO v_qtd, v_ordem FROM veic_veiculo_foto WHERE veiculo_id = p_veiculo_id;
  INSERT INTO veic_veiculo_foto (veiculo_id, company_id, storage_path, principal, ordem, created_by)
  VALUES (p_veiculo_id, v_company, p_storage_path, v_qtd = 0, v_ordem, p_user)
  RETURNING id INTO v_id;
  IF v_qtd = 0 THEN
    UPDATE veic_veiculo SET foto_url = p_storage_path, updated_at = now(), updated_by = p_user WHERE id = p_veiculo_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'principal', v_qtd = 0);
END $function$;
