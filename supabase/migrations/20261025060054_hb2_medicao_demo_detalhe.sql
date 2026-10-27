-- HB2 · Medição ao cliente (tela 273) — medição de exemplo na DEMO + "?" do detalhe e da conferência com o contrato.
-- Aditiva e idempotente: só insere linhas novas (medição demo e textos de ajuda); não altera dado existente.
-- Os preços da medição demo saem da MESMA regra do contrato (faixa pela quantidade, adicional % ou preço fixo da condição).
DO $$
DECLARE v_tab uuid := 'b0700000-0000-4000-a000-0000000e0001'; v_co uuid := 'b0700000-0000-4000-a000-000000000006';
  v_med uuid := 'b0700000-0000-4000-a000-0000000e0f01'; v_tot numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_tabela_preco_cliente WHERE id = v_tab AND company_id = v_co) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM erp_medicao_cliente WHERE id = v_med) THEN RETURN; END IF;
  INSERT INTO erp_medicao_cliente (id, company_id, tabela_id, descricao, periodo_inicio, periodo_fim, total)
  VALUES (v_med, v_co, v_tab, 'Medição setembro/2026 (exemplo)', '2026-09-01', '2026-09-30', 0);
  INSERT INTO erp_medicao_cliente_item (company_id, medicao_id, servico_ref, unidade, quantidade, condicao, faixa_de, faixa_ate, preco_unitario, total, codigo_externo)
  SELECT v_co, v_med, q.ref, i.unidade, q.qtd, q.cond, i.faixa_de, i.faixa_ate,
         round(COALESCE(k.preco_fixo, i.preco_base * (1 + COALESCE(c.percentual, 0) / 100)), 2),
         round(q.qtd * round(COALESCE(k.preco_fixo, i.preco_base * (1 + COALESCE(c.percentual, 0) / 100)), 2), 2),
         k.codigo_externo
    FROM (VALUES ('DEMO-S01', 250::numeric, 'normal'), ('DEMO-S02', 120::numeric, 'normal'), ('DEMO-S01', 80::numeric, 'sabado')) q(ref, qtd, cond)
    JOIN erp_tabela_preco_item i ON i.tabela_id = v_tab AND i.servico_ref = q.ref AND q.qtd >= i.faixa_de AND (i.faixa_ate IS NULL OR q.qtd < i.faixa_ate)
    LEFT JOIN erp_tabela_preco_condicao c ON c.tabela_id = v_tab AND c.condicao = q.cond AND q.cond <> 'normal'
    LEFT JOIN erp_tabela_preco_codigo k ON k.tabela_id = v_tab AND k.servico_ref = q.ref AND k.condicao = q.cond;
  SELECT COALESCE(sum(total), 0) INTO v_tot FROM erp_medicao_cliente_item WHERE medicao_id = v_med;
  UPDATE erp_medicao_cliente SET total = v_tot WHERE id = v_med;
END $$;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.medicao_ver', 'Ver itens da medição', 'Toque em Ver itens para abrir as linhas da medição salva.', 'Mostra serviço, quantidade, regime, código do cliente, preço e total de cada linha.', 'Medição setembro/2026: 3 linhas', 'Achar que o total muda ao abrir: a medição salva é uma fotografia do que foi medido.', 40),
 ('hub.tabela_preco.medicao_conferir', 'Conferir com o contrato', 'Toque em Conferir para recalcular a medição com os preços de hoje do contrato.', 'Mostra se o total salvo ainda bate com o contrato; se o contrato mudou depois, aponta a diferença.', 'Bate com o contrato: R$ 31.040,00', 'Editar o contrato depois de medir e estranhar a diferença: ela é esperada.', 41)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
