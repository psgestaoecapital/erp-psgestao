-- Seed DEMO: jornada de COTAÇÃO multi-fornecedor COMPLETA para a Comércio (GE) — DEMO
-- (company b0700000-...-0004). Tela /dashboard/commerce/compras (Hub "Compras com
-- Cotação Multi-Fornecedor"), auditor_pdca_2 13/11 (aud8 88/95).
--
-- O CÓDIGO da tela e das RPCs está BOM (verificado). O GAP é SEED: o DIFERENCIAL do
-- Hub — cotação de >=2 fornecedores comparada lado a lado, aprovar a melhor proposta,
-- virar pedido/compra e fechar a cadeia Princípio-4 (compra -> título a pagar -> baixa
-- de estoque) — não tinha NENHUMA linha no DEMO GE para mostrar/validar:
--   erp_cotacoes = 0; a única erp_compras (PC-9003, da cadeia de solicitação) estava
--   com titulos_gerados=FALSE e estoque_baixado=FALSE.
--
-- Este seed (ADITIVO, IDEMPOTENTE, SÓ DEMO) cria:
--   * 1 COTAÇÃO fechada (COT-9101) com 2 itens e 2 fornecedores concorrentes
--     (Fornecedor Demo 1 = vencedor R$605,00; Fornecedor Demo 2 = R$650,00),
--     propostas por item para os dois, vencedor marcado;
--   * o PEDIDO vencedor (PC-9009, erp_compras) ligado à cotação, levado ATÉ O FIM:
--       - fn_compra_gerar_titulos replicado -> 2 títulos em erp_pagar (2x R$302,50),
--         titulos_gerados=true;
--       - fn_compra_receber replicado -> 2 movimentos de entrada em
--         erp_estoque_movimentacoes, custo-médio recomposto (guarda custo-zero),
--         estoque_atual atualizado, estoque_baixado=true, status 'recebida_total'.
-- A compra PC-9003 (aberta, sem título/estoque) permanece INTACTA como o exemplo do
-- passo "a receber" pendente, como pedido pelo auditor.
--
-- Segurança: UUIDs fixos + guarda is_demo + guarda de idempotência pela cotação (se a
-- cotação já existe, nada roda de novo). NUNCA toca empresa real; sem dado pessoal novo
-- (reusa membros/fornecedores/produtos já existentes do DEMO). Réplica FIEL das RPCs
-- oficiais (fn_compra_gerar_titulos / fn_compra_receber) — em migration não há auth.uid(),
-- por isso usa-se um membro do DEMO como autor. fn_demo_reset NÃO toca nenhuma destas
-- tabelas (verificado) -> o seed é durável (sobrevive ao reset).
--
-- Code: code-desenvolvedor-3

DO $seed$
DECLARE
  v_co            uuid := 'b0700000-0000-4000-a000-000000000004';  -- Comércio (GE) - DEMO
  v_cot           uuid := 'd0c00004-0000-4000-c000-000000000001';  -- cotação COT-9101
  v_it1           uuid := 'd0c00004-0000-4000-c000-000000001001';  -- item 1 (Ferragem 2)
  v_it2           uuid := 'd0c00004-0000-4000-c000-000000001002';  -- item 2 (Vidro 3)
  v_f1            uuid := 'd0c00004-0000-4000-c000-00000000f001';  -- cotacao_fornecedor vencedor
  v_f2            uuid := 'd0c00004-0000-4000-c000-00000000f002';  -- cotacao_fornecedor concorrente
  v_compra        uuid := 'c0a70004-0000-4000-c000-000000000009';  -- pedido PC-9009
  v_ci1           uuid := 'c0a70004-0000-4000-c000-000000009001';  -- compra_item 1
  v_ci2           uuid := 'c0a70004-0000-4000-c000-000000009002';  -- compra_item 2
  -- Fornecedores reais do DEMO GE
  v_forn1         uuid := '2d419c1e-e78f-4ca1-9152-55ee6da29462';  -- Fornecedor Demo 1 (vencedor)
  v_forn1_nome    text := 'Fornecedor Demo 1';
  v_forn1_cnpj    text := '20000000000107';
  v_forn2         uuid := '6f541948-977b-46f6-9b7f-289a3e4fa337';  -- Fornecedor Demo 2
  v_forn2_nome    text := 'Fornecedor Demo 2';
  v_forn2_cnpj    text := '20000000000280';
  -- Produtos reais do DEMO GE
  v_p1            uuid := '9d41c186-d8fe-4ff6-987f-4f0724dfc6fd';  -- Ferragem 2 (GE-P002)
  v_p2            uuid := 'c35807fb-34a8-491a-8da6-044bc184a149';  -- Vidro 3 (GE-P003)
  v_local         uuid := '03189bb1-e6a1-446c-901f-ac2603ed0ee7';  -- estoque principal
  v_autor         uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';  -- membro acesso_total do DEMO
  -- Quantidades e preços da cotação
  v_q1            numeric := 10;   -- Ferragem 2
  v_q2            numeric := 5;    -- Vidro 3
  v_f1_p1         numeric := 38.00; v_f1_p2 numeric := 45.00;  -- vencedor: 380 + 225 = 605
  v_f2_p1         numeric := 41.00; v_f2_p2 numeric := 48.00;  -- concorrente: 410 + 240 = 650
  v_total1        numeric := 605.00;
  v_total2        numeric := 650.00;
  v_venc          date := CURRENT_DATE + 30;
  v_qa            numeric;  -- estoque antes
  v_cm            numeric;  -- custo médio atual
BEGIN
  -- Só no DEMO, e só se ainda não semeado (idempotência pela cotação).
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_co AND c.is_demo) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_cotacoes WHERE id = v_cot) THEN
    RETURN;
  END IF;

  -- 1) Cotação fechada com vencedor definido ------------------------------------
  INSERT INTO public.erp_cotacoes
    (id, company_id, numero, descricao, observacoes, data_abertura, data_limite,
     data_fechamento, status, fornecedor_vencedor_id, compra_gerada_id, solicitante,
     created_by, created_at, updated_at)
  VALUES
    (v_cot, v_co, 'COT-9101',
     'Reposição de ferragens e vidros — cotação com 2 fornecedores',
     'Cotação modelo (DEMO): compara 2 fornecedores lado a lado e aprova a melhor proposta.',
     CURRENT_DATE - 7, CURRENT_DATE - 2, CURRENT_DATE - 1,
     'fechada', v_forn1, v_compra, 'Compras (DEMO)',
     v_autor, now(), now());

  INSERT INTO public.erp_cotacoes_itens
    (id, cotacao_id, company_id, ordem, produto_id, produto_codigo, produto_nome,
     unidade, quantidade, created_at, updated_at)
  VALUES
    (v_it1, v_cot, v_co, 1, v_p1, 'GE-P002', 'Ferragem 2', 'UN', v_q1, now(), now()),
    (v_it2, v_cot, v_co, 2, v_p2, 'GE-P003', 'Vidro 3',    'UN', v_q2, now(), now());

  INSERT INTO public.erp_cotacoes_fornecedores
    (id, cotacao_id, company_id, fornecedor_id, fornecedor_nome, fornecedor_cnpj,
     status, data_convite, data_resposta, prazo_entrega_dias, condicao_pagamento,
     forma_pagamento, frete_tipo, frete_valor, subtotal, desconto_valor, total,
     created_at, updated_at)
  VALUES
    (v_f1, v_cot, v_co, v_forn1, v_forn1_nome, v_forn1_cnpj,
     'respondeu', now() - interval '7 day', now() - interval '3 day', 5, '30 dias',
     'boleto', 'CIF', 0, v_total1, 0, v_total1, now(), now()),
    (v_f2, v_cot, v_co, v_forn2, v_forn2_nome, v_forn2_cnpj,
     'respondeu', now() - interval '7 day', now() - interval '3 day', 7, '30 dias',
     'boleto', 'CIF', 0, v_total2, 0, v_total2, now(), now());

  -- Propostas por item (os 2 fornecedores respondem os 2 itens)
  INSERT INTO public.erp_cotacoes_propostas
    (id, cotacao_fornecedor_id, cotacao_item_id, company_id, preco_unitario,
     desconto_percentual, subtotal, disponivel, created_at, updated_at)
  VALUES
    ('d0c00004-0000-4000-c000-000000000011', v_f1, v_it1, v_co, v_f1_p1, 0, v_f1_p1*v_q1, true, now(), now()),
    ('d0c00004-0000-4000-c000-000000000012', v_f1, v_it2, v_co, v_f1_p2, 0, v_f1_p2*v_q2, true, now(), now()),
    ('d0c00004-0000-4000-c000-000000000021', v_f2, v_it1, v_co, v_f2_p1, 0, v_f2_p1*v_q1, true, now(), now()),
    ('d0c00004-0000-4000-c000-000000000022', v_f2, v_it2, v_co, v_f2_p2, 0, v_f2_p2*v_q2, true, now(), now());

  -- 2) Pedido vencedor (erp_compras) ligado à cotação --------------------------
  INSERT INTO public.erp_compras
    (id, company_id, numero, cotacao_origem_id, fornecedor_id, fornecedor_nome,
     fornecedor_cnpj, data_pedido, data_prevista, status, condicao_pagamento,
     forma_pagamento, parcelas, primeiro_vencimento, subtotal, total,
     estoque_baixado, titulos_gerados, data_recebimento,
     created_by, created_at, updated_at, aprovado_por, aprovado_em, aprovacao_motivo)
  VALUES
    (v_compra, v_co, 'PC-9009', v_cot, v_forn1, v_forn1_nome, v_forn1_cnpj,
     CURRENT_DATE - 1, CURRENT_DATE + 5, 'recebida_total', '30 dias',
     'boleto', 2, v_venc, v_total1, v_total1,
     true, true, CURRENT_DATE,
     v_autor, now(), now(), v_autor, now() - interval '1 day',
     'Melhor proposta da cotação COT-9101 (R$605,00 < R$650,00).');

  INSERT INTO public.erp_compras_itens
    (id, compra_id, company_id, ordem, produto_id, produto_codigo, produto_nome,
     unidade, quantidade, quantidade_recebida, preco_unitario, subtotal,
     created_at, updated_at)
  VALUES
    (v_ci1, v_compra, v_co, 1, v_p1, 'GE-P002', 'Ferragem 2', 'UN', v_q1, v_q1, v_f1_p1, v_f1_p1*v_q1, now(), now()),
    (v_ci2, v_compra, v_co, 2, v_p2, 'GE-P003', 'Vidro 3',    'UN', v_q2, v_q2, v_f1_p2, v_f1_p2*v_q2, now(), now());

  -- 3) Réplica de fn_compra_gerar_titulos: 2 parcelas de R$302,50 em erp_pagar ---
  INSERT INTO public.erp_pagar
    (id, company_id, fornecedor_id, fornecedor_nome, descricao, categoria, valor,
     data_emissao, data_vencimento, status, forma_pagamento, numero_documento,
     numero_nf, parcela, created_at)
  VALUES
    ('a0700004-0000-4000-c000-000000009001', v_co, v_forn1, v_forn1_nome,
     'Compra PC-9009', 'Compras de mercadorias', 302.50,
     CURRENT_DATE - 1, v_venc, 'aberto', 'boleto', 'PC-9009', NULL, '1/2', now()),
    ('a0700004-0000-4000-c000-000000009002', v_co, v_forn1, v_forn1_nome,
     'Compra PC-9009', 'Compras de mercadorias', 302.50,
     CURRENT_DATE - 1, (v_venc + interval '1 month')::date, 'aberto', 'boleto', 'PC-9009', NULL, '2/2', now());

  -- 4) Réplica de fn_compra_receber: entradas de estoque + custo médio -----------
  -- Item 1 (Ferragem 2)
  SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
    INTO v_qa, v_cm FROM public.erp_produtos WHERE id = v_p1;
  INSERT INTO public.erp_estoque_movimentacoes
    (company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes,
     quantidade_depois, custo_unitario, valor_total, ref_tipo, ref_id, ref_numero,
     usuario_id, data_movimento)
  VALUES
    (v_co, v_p1, v_local, 'entrada', 'Compra PC-9009', v_q1, v_qa, v_qa + v_q1,
     v_f1_p1, v_q1 * v_f1_p1, 'compra', v_compra, 'PC-9009', v_autor, now());
  UPDATE public.erp_produtos
     SET estoque_atual = v_qa + v_q1,
         preco_custo_medio = CASE WHEN v_qa <= 0 THEN v_f1_p1
                                  ELSE (v_qa * COALESCE(v_cm,0) + v_q1 * v_f1_p1) / (v_qa + v_q1) END,
         updated_at = now()
   WHERE id = v_p1;

  -- Item 2 (Vidro 3)
  SELECT COALESCE(estoque_atual,0), COALESCE(preco_custo_medio, preco_custo, 0)
    INTO v_qa, v_cm FROM public.erp_produtos WHERE id = v_p2;
  INSERT INTO public.erp_estoque_movimentacoes
    (company_id, produto_id, local_id, tipo, motivo, quantidade, quantidade_antes,
     quantidade_depois, custo_unitario, valor_total, ref_tipo, ref_id, ref_numero,
     usuario_id, data_movimento)
  VALUES
    (v_co, v_p2, v_local, 'entrada', 'Compra PC-9009', v_q2, v_qa, v_qa + v_q2,
     v_f1_p2, v_q2 * v_f1_p2, 'compra', v_compra, 'PC-9009', v_autor, now());
  UPDATE public.erp_produtos
     SET estoque_atual = v_qa + v_q2,
         preco_custo_medio = CASE WHEN v_qa <= 0 THEN v_f1_p2
                                  ELSE (v_qa * COALESCE(v_cm,0) + v_q2 * v_f1_p2) / (v_qa + v_q2) END,
         updated_at = now()
   WHERE id = v_p2;
END
$seed$;
