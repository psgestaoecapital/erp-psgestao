-- Revenda · item 4 — a vistoria do Corolla volta ao seed único (RD-69).
--
-- O roteiro precisa de ≥ 2 vistorias concluídas na Demo: o Onix (reparo, já existia) e o Corolla
-- (reparo de R$ 900). Sem ela, fn_demo_reset entregava só 1 vistoria. Aqui o helper da precificação
-- (que já roda no fim da cadeia do seed) passa a criar também a vistoria do Corolla — determinístico e
-- idempotente (o DELETE no topo limpa e recria). Nada além da vistoria muda: OS de preparação (2),
-- fotos (16), recebimentos (5↔5), negociações (2), eventos (37) e histórico (18) seguem iguais.
-- Aditivo (RD-55, CREATE OR REPLACE). Preserva a chamada do fn_gold_revenda_seed_fiscal (#1654).

CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_precificacao(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000003'; v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_onix uuid; v_modelo uuid; v_vist uuid; v_it1 uuid; v_it2 uuid; v_prev numeric; v_onix2 uuid; v_onix3 uuid;
  v_corolla uuid; v_vist_c uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;
  SELECT id INTO v_onix FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00003' LIMIT 1;
  SELECT id INTO v_corolla FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00004' LIMIT 1;
  SELECT id INTO v_modelo FROM insp_modelo WHERE company_id=v_bot AND escopo='veiculo_revenda' AND nome ILIKE '%rápida%' LIMIT 1;
  IF v_modelo IS NULL THEN SELECT id INTO v_modelo FROM insp_modelo WHERE company_id=v_bot AND escopo='veiculo_revenda' LIMIT 1; END IF;
  DELETE FROM insp_resposta WHERE company_id=v_bot;
  DELETE FROM insp_vistoria WHERE company_id=v_bot AND escopo='veiculo_revenda';
  DELETE FROM veic_avaliacao_recusa WHERE company_id=v_bot;
  DELETE FROM veic_veiculo WHERE company_id=v_bot AND chassi IN ('DEMO0REVENDA0ONIX2','DEMO0REVENDA0ONIX3');
  IF v_modelo IS NOT NULL THEN
    SELECT i.id INTO v_it1 FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id WHERE r.modelo_id=v_modelo ORDER BY r.ordem, i.ordem LIMIT 1;
    SELECT i.id INTO v_it2 FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id WHERE r.modelo_id=v_modelo AND i.id <> v_it1 ORDER BY r.ordem, i.ordem OFFSET 1 LIMIT 1;
  END IF;
  -- (a) VISTORIA do Onix: 2 reparos (previsão 3.500) — para recusar item e ver o preço mínimo cair.
  IF v_onix IS NOT NULL AND v_it1 IS NOT NULL THEN
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
  -- (a2) VISTORIA do Corolla: 1 reparo de R$ 900 (a 2ª vistoria concluída que o roteiro exige).
  IF v_corolla IS NOT NULL AND v_it1 IS NOT NULL THEN
    INSERT INTO insp_vistoria (company_id, modelo_id, escopo, alvo_tabela, alvo_id, situacao, km, previsao_total, observacao, iniciada_em, concluida_em, criado_por)
    VALUES (v_bot, v_modelo, 'veiculo_revenda', 'veic_veiculo', v_corolla, 'concluida', 52000, 900, 'Vistoria de entrada (demo).', now()-interval '30 days', now()-interval '29 days', v_robo)
    RETURNING id INTO v_vist_c;
    INSERT INTO insp_resposta (company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, respondido_por, respondido_em)
    VALUES (v_bot, v_vist_c, v_it1, 'reparo', 'Retoque de pintura + polimento', 900, v_robo, now()-interval '29 days');
  END IF;
  INSERT INTO veic_veiculo (company_id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, preco_minimo, precificado_em, ativo, observacao, created_by)
  VALUES (v_bot, 'DEMO0REVENDA0ONIX2', 'Chevrolet', 'Onix 1.0', 2022, 2023, 'Branco', 'flex', 42000, 'disponivel', 'compra_pj', current_date-25, 46000, 58000, NULL, now()-interval '5 days', true, 'Segundo Onix no pátio — comparação de preço.', v_robo)
  RETURNING id INTO v_onix2;
  INSERT INTO veic_veiculo (company_id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, ativo, observacao, created_by)
  VALUES (v_bot, 'DEMO0REVENDA0ONIX3', 'Chevrolet', 'Onix 1.0', 2021, 2022, 'Prata', 'flex', 55000, 'entregue', 'compra_pj', current_date-68, 44000, 57000, true, 'Onix vendido — histórico de giro.', v_robo)
  RETURNING id INTO v_onix3;
  INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, data_venda, valor_venda, valor_entrada, situacao, vendedor_nome, observacao, created_by)
  VALUES (v_bot, v_onix3, 'DEMO-V-ONIX3', 'Cliente Onix', current_date-40, 57000, 57000, 'entregue', 'Marcos Souza', 'Venda histórica (giro).', v_robo);

  -- o perfil fiscal Presumido/SC de demonstração também nasce do seed único.
  PERFORM fn_gold_revenda_seed_fiscal(v_bot);

  RETURN jsonb_build_object('ok', true, 'onix', v_onix, 'vistoria', v_vist, 'previsao', v_prev,
    'corolla', v_corolla, 'vistoria_corolla', v_vist_c, 'onix_patio', v_onix2, 'onix_vendido', v_onix3);
END $function$;

-- Popula na Demo ao aplicar (idempotente, só [BOT] Revenda).
SELECT public.fn_gold_revenda_seed_precificacao('b0700000-0000-4000-a000-000000000003');
