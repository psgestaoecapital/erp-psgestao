-- ============================================================
-- ONDA 1 (V2) · Revenda · a composicao real do negocio aparece na tela
-- ============================================================
-- V1 (sobre veic_proposta_troca) foi descartado: aquela tabela esta VAZIA. O fluxo que roda e
-- veic_venda (fn_veic_venda_registrar), que JA calcula o sobrepreco e JA faz o usado entrar por
-- valor_avaliacao. Faltava (a) corrigir um bug de COALESCE que inventa sobrepreco, e (b) a RPC de
-- leitura das duas margens. Nada de coluna nova, nada de logica duplicada.

-- ------------------------------------------------------------
-- BLOCO 1 · fn_veic_venda_registrar: sobrepreco so existe se houver os DOIS valores
-- ------------------------------------------------------------
-- Bug: v_desc := COALESCE(v_troca_val,0) - COALESCE(v_aval,0). Sem avaliacao, COALESCE(v_aval,0)
-- assume que o usado vale zero e grava a troca INTEIRA como sobrepreco (uma troca de 40k vira "40k de
-- desconto"). Sem avaliacao o sobrepreco NAO e zero nem o valor cheio: e desconhecido (RD-51/58).
-- CREATE OR REPLACE da funcao inteira, preservando todo o resto (guards, troca_chassi_ja_cadastrado,
-- laco de recebimentos com fn_veic__receber, mudanca de situacao). So a linha do v_desc muda.
CREATE OR REPLACE FUNCTION public.fn_veic_venda_registrar(p_company_id uuid, p_veiculo_id uuid, p_venda jsonb, p_recebimentos jsonb, p_troca jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    -- parse seguro dos valores da troca (não-numérico não estoura o cast)
    BEGIN v_troca_val := NULLIF(btrim(p_troca->>'valor_troca'),'')::numeric; EXCEPTION WHEN others THEN v_troca_val := NULL; END;
    BEGIN v_aval := NULLIF(btrim(p_troca->>'valor_avaliacao'),'')::numeric; EXCEPTION WHEN others THEN v_aval := NULL; END;
    -- sobrepreco so existe com os DOIS valores; sem avaliacao e desconhecido (NULL), nao zero
    IF v_troca_val IS NOT NULL AND v_aval IS NOT NULL THEN
      v_desc := v_troca_val - v_aval;
    ELSE
      v_desc := NULL;
    END IF;
    v_troca_chassi := NULLIF(btrim(p_troca->>'chassi'),'');
  END IF;

  -- o usado da troca entra em veic_veiculo (chassi UNIQUE por empresa). Se já existe no pátio,
  -- avisa ANTES de inserir a venda — senão a venda gravava e a troca estourava 23505 cru.
  IF v_troca_chassi IS NOT NULL AND EXISTS (
      SELECT 1 FROM veic_veiculo WHERE company_id = p_company_id AND chassi = v_troca_chassi AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'troca_chassi_ja_cadastrado', 'campo', 'troca_chassi'); END IF;

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

-- ------------------------------------------------------------
-- BLOCO 2 · fn_veic_venda_composicao — as duas margens, so ate custo lancado (carrego e Ondas 3/4)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_venda_composicao(p_venda_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_custos numeric; v_custo_total numeric;
  v_margem_aparente numeric; v_margem_real numeric; v_incerteza text;
  v_usado record;
BEGIN
  SELECT s.id, s.company_id, s.veiculo_id, s.valor_venda, s.desconto_embutido_troca,
         s.valor_entrada, s.valor_financiado, s.banco_nome, s.retorno_banco,
         s.situacao, s.nfe_id, s.cliente_nome, s.vendedor_nome, s.data_venda,
         v2.marca, v2.modelo, v2.placa, v2.valor_aquisicao, v2.data_entrada
    INTO v
    FROM veic_venda s
    JOIN veic_veiculo v2 ON v2.id = s.veiculo_id
   WHERE s.id = p_venda_id AND s.deleted_at IS NULL;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;

  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(sum(c.valor),0) INTO v_custos
    FROM veic_custo c WHERE c.veiculo_id = v.veiculo_id AND c.deleted_at IS NULL;

  v_custo_total := COALESCE(v.valor_aquisicao,0) + v_custos;

  -- o usado que entrou nesta troca (origem='troca', criado pela venda)
  SELECT vv.id, vv.placa, vv.marca, vv.modelo, vv.valor_aquisicao AS entrou_por
    INTO v_usado
    FROM veic_veiculo_evento e
    JOIN veic_veiculo vv ON vv.id = e.veiculo_id
   WHERE e.tipo = 'entrada' AND e.payload->>'venda_id' = p_venda_id::text
   LIMIT 1;

  -- margem aparente: a conta que todo sistema mostra
  v_margem_aparente := COALESCE(v.valor_venda,0) - v_custo_total;

  -- margem real: o sobrepreço da troca sai da receita; retorno do banco é receita
  v_margem_real := COALESCE(v.valor_venda,0)
                 - COALESCE(v.desconto_embutido_troca,0)
                 - v_custo_total
                 + COALESCE(v.retorno_banco,0);

  -- incerteza: desconto_embutido_troca IS NULL e AMBIGUO (NULLIF(v_desc,0) colapsa "desconhecido" e
  -- "exatamente zero" no mesmo NULL). O discriminador honesto e o preco de entrada do usado: se ele
  -- entrou com valor (entrou_por IS NOT NULL), houve avaliacao -> sobrepreco NULL e zero legitimo, nao
  -- desconhecido. So alarma "sem avaliacao" quando o usado entrou SEM valor (entrou_por IS NULL). Sem
  -- isso, uma troca limpa (troca = avaliacao) aparecia como "avaliacao nao informada" — falso alarme
  -- (RD-51/58: declarar incerteza onde nao existe e tao ruim quanto esconde-la).
  v_incerteza := CASE
    WHEN v_usado.id IS NOT NULL AND v_usado.entrou_por IS NULL
      THEN 'troca_sem_avaliacao_sobrepreco_desconhecido'
    WHEN COALESCE(v.valor_aquisicao,0) = 0
      THEN 'veiculo_sem_valor_de_aquisicao'
    WHEN v_custos = 0
      THEN 'nenhum_custo_lancado_neste_veiculo'
    ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'venda_id', v.id,
    'veiculo', jsonb_build_object('placa', v.placa, 'marca', v.marca, 'modelo', v.modelo),
    'valor_venda', v.valor_venda,
    'valor_aquisicao', v.valor_aquisicao,
    'custos_lancados', v_custos,
    'custo_total', v_custo_total,
    'sobrepreco_troca', v.desconto_embutido_troca,
    'usado_recebido', CASE WHEN v_usado.id IS NULL THEN NULL ELSE jsonb_build_object(
        'veiculo_id', v_usado.id, 'placa', v_usado.placa,
        'marca', v_usado.marca, 'modelo', v_usado.modelo,
        'entrou_no_estoque_por', v_usado.entrou_por) END,
    'financiamento', jsonb_build_object(
        'entrada', v.valor_entrada, 'financiado', v.valor_financiado,
        'banco', v.banco_nome, 'retorno_banco', v.retorno_banco),
    'margem_aparente', v_margem_aparente,
    'margem_real', v_margem_real,
    'margem_aparente_pct', CASE WHEN v_custo_total > 0
        THEN round((v_margem_aparente / v_custo_total * 100)::numeric, 2) END,
    'margem_real_pct', CASE WHEN v_custo_total > 0
        THEN round((v_margem_real / v_custo_total * 100)::numeric, 2) END,
    'dias_em_estoque', (v.data_venda - v.data_entrada),
    'tem_nota', v.nfe_id IS NOT NULL,
    'incerteza', v_incerteza
  );
END $function$;
