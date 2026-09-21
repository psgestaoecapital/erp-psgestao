-- Revenda R6a · SEED da precificação (RD-69) — demo ganha o que o roteiro T8 exige, sobrevive ao reset.
--
-- O roteiro precisa de: (a) o Onix com uma VISTORIA CONCLUÍDA com item de reparo (para recusar e ver o
-- preço mínimo cair na fonte única); (b) um 2º Onix NO PÁTIO (comparação de estoque do mesmo modelo);
-- (c) um Onix VENDIDO no histórico (giro do modelo = dias-a-vender). Determinístico e idempotente.
--
-- RD-69: entra na cadeia do seed único. Em vez de reescrever o fn_gold_revenda_seed_reparar (200+ linhas),
-- fn_gold_revenda_seed_negociacoes (que o seed já chama no fim) passa a chamar este helper no fim —
-- assim um fn_demo_reset restaura também a precificação.

CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_precificacao(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000003'; v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_onix uuid; v_modelo uuid; v_vist uuid; v_it1 uuid; v_it2 uuid; v_prev numeric;
  v_onix2 uuid; v_onix3 uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;

  -- Onix "assunto" (recriado a cada reset pelo seed grande) — pega o atual.
  SELECT id INTO v_onix FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00003' LIMIT 1;

  -- template de vistoria da revenda (rápida — carro); se não houver, sai sem erro (nada a semear).
  SELECT id INTO v_modelo FROM insp_modelo WHERE company_id=v_bot AND escopo='veiculo_revenda' AND nome ILIKE '%rápida%' LIMIT 1;
  IF v_modelo IS NULL THEN
    SELECT id INTO v_modelo FROM insp_modelo WHERE company_id=v_bot AND escopo='veiculo_revenda' LIMIT 1; END IF;

  -- limpeza determinística: apaga vistorias/respostas sintéticas da demo e os Onix extras.
  DELETE FROM insp_resposta WHERE company_id=v_bot;
  DELETE FROM insp_vistoria WHERE company_id=v_bot AND escopo='veiculo_revenda';
  DELETE FROM veic_avaliacao_recusa WHERE company_id=v_bot;
  DELETE FROM veic_veiculo WHERE company_id=v_bot AND chassi IN ('DEMO0REVENDA0ONIX2','DEMO0REVENDA0ONIX3');

  -- (a) VISTORIA CONCLUÍDA do Onix com 2 itens de reparo (previsão 3.500) — se há template com itens.
  IF v_onix IS NOT NULL AND v_modelo IS NOT NULL THEN
    SELECT i.id INTO v_it1 FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id
      WHERE r.modelo_id=v_modelo ORDER BY r.ordem, i.ordem LIMIT 1;
    SELECT i.id INTO v_it2 FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id
      WHERE r.modelo_id=v_modelo AND i.id <> v_it1 ORDER BY r.ordem, i.ordem OFFSET 1 LIMIT 1;
    IF v_it1 IS NOT NULL THEN
      INSERT INTO insp_vistoria (company_id, modelo_id, escopo, alvo_tabela, alvo_id, situacao, km, previsao_total, observacao, iniciada_em, concluida_em, criado_por)
      VALUES (v_bot, v_modelo, 'veiculo_revenda', 'veic_veiculo', v_onix, 'concluida', 38000, 0, 'Vistoria de entrada (demo).', now()-interval '40 days', now()-interval '39 days', v_robo)
      RETURNING id INTO v_vist;
      INSERT INTO insp_resposta (company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, respondido_por, respondido_em)
      VALUES (v_bot, v_vist, v_it1, 'reparo', 'Troca de pastilhas + disco dianteiro', 2000, v_robo, now()-interval '39 days');
      v_prev := 2000;
      IF v_it2 IS NOT NULL THEN
        INSERT INTO insp_resposta (company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, respondido_por, respondido_em)
        VALUES (v_bot, v_vist, v_it2, 'reparo', 'Revisão do ar-condicionado', 1500, v_robo, now()-interval '39 days');
        v_prev := 3500;
      END IF;
      UPDATE insp_vistoria SET previsao_total = v_prev WHERE id = v_vist;
    END IF;
  END IF;

  -- (b) 2º Onix NO PÁTIO (comparação de estoque do mesmo modelo).
  INSERT INTO veic_veiculo (company_id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, preco_minimo, precificado_em, ativo, observacao, created_by)
  VALUES (v_bot, 'DEMO0REVENDA0ONIX2', 'Chevrolet', 'Onix 1.0', 2022, 2023, 'Branco', 'flex', 42000, 'disponivel', 'compra_pj', current_date-25, 46000, 58000, NULL, now()-interval '5 days', true, 'Segundo Onix no pátio — comparação de preço.', v_robo)
  RETURNING id INTO v_onix2;

  -- (c) Onix VENDIDO (giro do modelo): entrou há 68 dias, vendido há 40 → ~28 dias a vender.
  INSERT INTO veic_veiculo (company_id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, ativo, observacao, created_by)
  VALUES (v_bot, 'DEMO0REVENDA0ONIX3', 'Chevrolet', 'Onix 1.0', 2021, 2022, 'Prata', 'flex', 55000, 'entregue', 'compra_pj', current_date-68, 44000, 57000, true, 'Onix vendido — histórico de giro.', v_robo)
  RETURNING id INTO v_onix3;
  INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, data_venda, valor_venda, valor_entrada, situacao, vendedor_nome, observacao, created_by)
  VALUES (v_bot, v_onix3, 'DEMO-V-ONIX3', 'Cliente Onix', current_date-40, 57000, 57000, 'entregue', 'Marcos Souza', 'Venda histórica (giro).', v_robo);

  RETURN jsonb_build_object('ok', true, 'onix', v_onix, 'vistoria', v_vist, 'previsao', v_prev,
    'onix_patio', v_onix2, 'onix_vendido', v_onix3);
END $function$;

-- ── RD-69: liga o seed da precificação ao fim do seed das negociações (já chamado pelo seed único).
--    Corpo idêntico ao R5a + PERFORM fn_gold_revenda_seed_precificacao(v_bot) no fim.
CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_negociacoes(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_bot uuid := 'b0700000-0000-4000-a000-000000000003'; v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_corolla uuid; v_ka uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;
  UPDATE veic_config SET desconto_max_pct = 5, coaf_limite_especie = 30000, updated_at = now() WHERE company_id = v_bot;

  SELECT id INTO v_corolla FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00004' LIMIT 1;
  SELECT id INTO v_ka      FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00009' LIMIT 1;

  DELETE FROM veic_negociacao WHERE company_id = v_bot;

  IF v_corolla IS NOT NULL THEN
    INSERT INTO veic_negociacao (id, company_id, veiculo_id, cliente_nome, cliente_doc, vendedor_nome, estado, validade,
      preco_pedido, desconto, troca_avaliacao, troca_valor_dado, troca_chassi, troca_marca, troca_modelo, troca_ano, troca_km,
      entrada, financiado, banco_nome, parcelas, especie_valor, observacao, created_by)
    VALUES (md5(v_bot::text||':neg:aberta')::uuid, v_bot, v_corolla, 'Fernanda Dias', '390.533.447-05', 'Marcos Souza', 'aberta', current_date + 7,
      118000, 8000, 35000, 40000, '9BWERTUIO12345678', 'Chevrolet', 'Onix', 2018, 96000,
      20000, 53000, 'Banco Pan', 24, 35000, 'Cliente quer levar hoje; troca do Onix 2018.', v_robo);
  END IF;

  IF v_ka IS NOT NULL THEN
    INSERT INTO veic_negociacao (id, company_id, veiculo_id, cliente_nome, vendedor_nome, estado, preco_pedido, desconto, motivo_perda, created_by)
    VALUES (md5(v_bot::text||':neg:perdida')::uuid, v_bot, v_ka, 'Otávio Ramos', 'Marcos Souza', 'perdida', 39000, 0, 'Cliente comprou em outra loja por preço menor.', v_robo);
  END IF;

  -- R6a (RD-69): a precificação da demo também nasce do seed único.
  PERFORM fn_gold_revenda_seed_precificacao(v_bot);

  RETURN jsonb_build_object('ok', true, 'negociacoes', (SELECT count(*) FROM veic_negociacao WHERE company_id=v_bot));
END $function$;

-- Popula na Demo ao aplicar (idempotente, só [BOT] Revenda) — o seed grande já roda em outras migrations,
-- aqui garantimos a precificação sem reprocessar tudo.
SELECT public.fn_gold_revenda_seed_precificacao('b0700000-0000-4000-a000-000000000003');
