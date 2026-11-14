-- PDCA GE · /dashboard/commerce/compras (aud8 88/95) — Code: code-desenvolvedor-3
--
-- Dois gaps do auditor nesta tela:
--   (1) RD-98 p3: system_screens.views_consumidas e rpcs_chamadas vazios (0/0).
--   (2) Jornada cotação -> comparativo -> pedido não verificável: DEMO sem nenhuma
--       cotação (erp_cotacoes = 0 linhas para a empresa DEMO Comércio GE).
--
-- Esta migration é ADITIVA e idempotente, só mexe na empresa DEMO Comércio GE
-- (b0700000-0000-4000-a000-000000000004) e em metadado (system_screens).
-- Nenhum dado de cliente é alterado.

-- ===========================================================================
-- (1) RD-98 p3 — origem do dado registrada (fonte: leitura do page.tsx, RD-38)
--     .from(): erp_compras, erp_compras_itens, erp_cotacoes, erp_cotacoes_fornecedores,
--              erp_cotacoes_itens, erp_cotacoes_propostas, erp_fornecedores, erp_produtos
--     .rpc():  fn_aprovar_proposta_cotacao, fn_compra_gerar_titulos, fn_compra_receber,
--              fn_cotacao_proposta_salvar, fn_resumo_cotacao
-- ===========================================================================
UPDATE system_screens
   SET views_consumidas = ARRAY[
         'erp_compras','erp_compras_itens','erp_cotacoes','erp_cotacoes_fornecedores',
         'erp_cotacoes_itens','erp_cotacoes_propostas','erp_fornecedores','erp_produtos'
       ],
       rpcs_chamadas = ARRAY[
         'fn_aprovar_proposta_cotacao','fn_compra_gerar_titulos','fn_compra_receber',
         'fn_cotacao_proposta_salvar','fn_resumo_cotacao'
       ],
       atualizado_em = now()
 WHERE rota = '/dashboard/commerce/compras';

-- ===========================================================================
-- (2) Seed DEMO: 1 cotação-exemplo com 2 fornecedores que responderam,
--     2 itens e 4 propostas (precos diferentes -> há um vencedor claro),
--     para a jornada cotação -> comparativo -> pedido ficar demonstrável.
--     Idempotente por marcador em erp_cotacoes.observacoes. Só DEMO Comércio GE.
-- ===========================================================================
-- ci-sem-guarda: fn_demo_seed_ge_cotacao — seeder DEMO-only; grava só na empresa
--   DEMO Comércio GE fixa (b0700000-0000-4000-a000-000000000004), travada logo no
--   início (IF p_company <> v_bot THEN RETURN). Não toca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_cotacao(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot  uuid := 'b0700000-0000-4000-a000-000000000004';
  v_mark text := 'seed:ge-comercial-cotacao';
  v_cot  uuid; v_fa uuid; v_fb uuid; v_i1 uuid; v_i2 uuid;
  v_p1 record; v_p2 record; v_forn_a record; v_forn_b record;
  v_q1 numeric := 10; v_q2 numeric := 5;
BEGIN
  IF p_company <> v_bot THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge');
  END IF;

  -- RESET idempotente do que ESTE seed cria (ordem FK-safe)
  DELETE FROM erp_cotacoes_propostas cp
    USING erp_cotacoes_fornecedores cf, erp_cotacoes c
   WHERE cp.cotacao_fornecedor_id = cf.id AND cf.cotacao_id = c.id
     AND c.company_id = v_bot AND c.observacoes = v_mark;
  DELETE FROM erp_cotacoes_fornecedores cf
    USING erp_cotacoes c
   WHERE cf.cotacao_id = c.id AND c.company_id = v_bot AND c.observacoes = v_mark;
  DELETE FROM erp_cotacoes_itens ci
    USING erp_cotacoes c
   WHERE ci.cotacao_id = c.id AND c.company_id = v_bot AND c.observacoes = v_mark;
  DELETE FROM erp_cotacoes WHERE company_id = v_bot AND observacoes = v_mark;

  -- 2 produtos reais e 2 fornecedores reais da DEMO
  SELECT id, codigo, nome, unidade INTO v_p1 FROM erp_produtos
   WHERE company_id = v_bot ORDER BY created_at, id OFFSET 0 LIMIT 1;
  SELECT id, codigo, nome, unidade INTO v_p2 FROM erp_produtos
   WHERE company_id = v_bot ORDER BY created_at, id OFFSET 1 LIMIT 1;
  SELECT id, nome_fantasia, razao_social, cnpj_cpf INTO v_forn_a FROM erp_fornecedores
   WHERE company_id = v_bot ORDER BY created_at, id OFFSET 0 LIMIT 1;
  SELECT id, nome_fantasia, razao_social, cnpj_cpf INTO v_forn_b FROM erp_fornecedores
   WHERE company_id = v_bot ORDER BY created_at, id OFFSET 1 LIMIT 1;

  IF v_p1.id IS NULL OR v_p2.id IS NULL OR v_forn_a.id IS NULL OR v_forn_b.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'faltam_produtos_ou_fornecedores_na_demo');
  END IF;

  -- Cotação (status 'enviada' — NÃO aprovada, p/ não disparar trg_os_cotacao_aprovada)
  INSERT INTO erp_cotacoes
    (company_id, numero, descricao, observacoes, data_abertura, data_limite, status, solicitante)
  VALUES
    (v_bot, 'COT-DEMO-GE-01',
     'Compra de materiais — cotação exemplo com 2 fornecedores (demo)', v_mark,
     CURRENT_DATE, CURRENT_DATE + 7, 'enviada', 'Compras (demo)')
  RETURNING id INTO v_cot;

  -- Itens
  INSERT INTO erp_cotacoes_itens
    (cotacao_id, company_id, ordem, produto_id, produto_codigo, produto_nome, unidade, quantidade)
  VALUES
    (v_cot, v_bot, 1, v_p1.id, v_p1.codigo, COALESCE(v_p1.nome,'Item 1'), COALESCE(v_p1.unidade,'UN'), v_q1)
  RETURNING id INTO v_i1;
  INSERT INTO erp_cotacoes_itens
    (cotacao_id, company_id, ordem, produto_id, produto_codigo, produto_nome, unidade, quantidade)
  VALUES
    (v_cot, v_bot, 2, v_p2.id, v_p2.codigo, COALESCE(v_p2.nome,'Item 2'), COALESCE(v_p2.unidade,'UN'), v_q2)
  RETURNING id INTO v_i2;

  -- Fornecedores (responderam)
  INSERT INTO erp_cotacoes_fornecedores
    (cotacao_id, company_id, fornecedor_id, fornecedor_nome, fornecedor_cnpj,
     status, data_convite, data_resposta, prazo_entrega_dias, condicao_pagamento)
  VALUES
    (v_cot, v_bot, v_forn_a.id, COALESCE(v_forn_a.nome_fantasia, v_forn_a.razao_social, 'Fornecedor A'),
     v_forn_a.cnpj_cpf, 'respondida', now(), now(), 7, '30 dias')
  RETURNING id INTO v_fa;
  INSERT INTO erp_cotacoes_fornecedores
    (cotacao_id, company_id, fornecedor_id, fornecedor_nome, fornecedor_cnpj,
     status, data_convite, data_resposta, prazo_entrega_dias, condicao_pagamento)
  VALUES
    (v_cot, v_bot, v_forn_b.id, COALESCE(v_forn_b.nome_fantasia, v_forn_b.razao_social, 'Fornecedor B'),
     v_forn_b.cnpj_cpf, 'respondida', now(), now(), 10, '28 dias')
  RETURNING id INTO v_fb;

  -- Propostas (preços diferentes -> Fornecedor B é o menor: A=310,00 / B=300,00)
  INSERT INTO erp_cotacoes_propostas
    (cotacao_fornecedor_id, cotacao_item_id, company_id, preco_unitario, subtotal, disponivel)
  VALUES
    (v_fa, v_i1, v_bot, 25.00, round(25.00 * v_q1, 2), true),
    (v_fa, v_i2, v_bot, 12.00, round(12.00 * v_q2, 2), true),
    (v_fb, v_i1, v_bot, 23.50, round(23.50 * v_q1, 2), true),
    (v_fb, v_i2, v_bot, 13.00, round(13.00 * v_q2, 2), true);

  -- Totais por fornecedor no cabeçalho
  UPDATE erp_cotacoes_fornecedores cf
     SET subtotal = s.t, total = s.t
    FROM (SELECT cotacao_fornecedor_id, SUM(subtotal) AS t
            FROM erp_cotacoes_propostas
           WHERE cotacao_fornecedor_id IN (v_fa, v_fb)
           GROUP BY cotacao_fornecedor_id) s
   WHERE cf.id = s.cotacao_fornecedor_id;

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'cotacao', 'cotacao_id', v_cot,
    'fornecedores', 2, 'itens', 2, 'propostas', 4
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_cotacao(uuid) FROM anon;

-- Semeia a DEMO Comércio GE agora (idempotente). GUARDADO: um erro de runtime do
-- seed NUNCA derruba o deploy-migrations — apenas registra um NOTICE. O seed também
-- roda de forma durável a cada fn_demo_reset (via fn_demo_seed_ge_comercial abaixo).
DO $seed$
BEGIN
  PERFORM public.fn_demo_seed_ge_cotacao('b0700000-0000-4000-a000-000000000004');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'seed cotacao DEMO GE nao aplicado (nao bloqueia deploy): %', SQLERRM;
END
$seed$;

-- ===========================================================================
-- Durabilidade: o seed de cotação passa a rodar junto do seed comercial da DEMO
-- (fn_demo_seed_ge_comercial é chamado por fn_demo_reset), para a cotação
-- sobreviver a cada reset da DEMO. Corpo idêntico ao vivo + PERFORM do novo bloco.
-- ===========================================================================
-- ci-sem-guarda: fn_demo_seed_ge_comercial — seeder DEMO-only; grava só na empresa
--   DEMO Comércio GE fixa (b0700000-0000-4000-a000-000000000004), travada logo no
--   início (IF p_company <> v_bot THEN RETURN). Não toca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_comercial(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_mark text := 'seed:ge-comercial';
  v_motivo uuid;
  v_orc_ids uuid[]; v_ped_ids uuid[];
  v_new_orc uuid[] := '{}'; v_new_ped uuid[] := '{}';
  v_i int; v_j int; v_orc uuid; v_ped uuid;
  v_cli record; v_p1 record; v_p2 record;
  v_num text; v_total numeric; v_nparc int; v_vparc numeric; v_venc date;
  v_conv int := 0; v_fat int := 0; v_canc int := 0; v_aberto int := 0;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;

  -- motivo de perda (idempotente) para o cancelamento oficial
  SELECT id INTO v_motivo FROM erp_motivo_perda WHERE company_id=v_bot AND nome='Cliente desistiu (demo)' AND ativo LIMIT 1;
  IF v_motivo IS NULL THEN
    INSERT INTO erp_motivo_perda (company_id, nome, ativo, exige_descricao)
    VALUES (v_bot, 'Cliente desistiu (demo)', true, false) RETURNING id INTO v_motivo;
  END IF;

  -- RESET idempotente do que ESTE seed cria (ordem FK-safe; erp_receber é doc financeiro → escape)
  v_orc_ids := ARRAY(SELECT id FROM erp_orcamentos WHERE company_id=v_bot AND observacoes=v_mark);
  v_ped_ids := ARRAY(SELECT id FROM erp_pedidos   WHERE company_id=v_bot AND observacoes=v_mark);
  IF array_length(v_ped_ids,1) > 0 THEN
    PERFORM set_config('app.permitir_delete_fisico','on',true);
    DELETE FROM erp_receber WHERE company_id=v_bot AND pedido_id = ANY(v_ped_ids);
    PERFORM set_config('app.permitir_delete_fisico','off',true);
    DELETE FROM erp_estoque_movimentacoes WHERE company_id=v_bot AND ref_tipo='pedido' AND ref_id = ANY(v_ped_ids);
    DELETE FROM erp_pedidos_parcelas WHERE company_id=v_bot AND pedido_id = ANY(v_ped_ids);
    DELETE FROM erp_pedidos_itens    WHERE company_id=v_bot AND pedido_id = ANY(v_ped_ids);
    DELETE FROM erp_pedidos          WHERE company_id=v_bot AND id = ANY(v_ped_ids);
  END IF;
  IF array_length(v_orc_ids,1) > 0 THEN
    DELETE FROM erp_orcamentos_itens WHERE company_id=v_bot AND orcamento_id = ANY(v_orc_ids);
    DELETE FROM erp_orcamentos       WHERE company_id=v_bot AND id = ANY(v_orc_ids);
  END IF;

  -- 10 orçamentos (cada um: 2 produtos do estoque demo), cliente distinto
  FOR v_i IN 1..10 LOOP
    SELECT id, nome_fantasia INTO v_cli FROM erp_clientes
      WHERE company_id=v_bot ORDER BY created_at, id OFFSET (v_i-1) LIMIT 1;
    SELECT id,codigo,nome,preco_venda,preco_custo_medio INTO v_p1 FROM erp_produtos
      WHERE company_id=v_bot AND codigo='GE-P'||lpad((8+v_i)::text,3,'0');
    SELECT id,codigo,nome,preco_venda,preco_custo_medio INTO v_p2 FROM erp_produtos
      WHERE company_id=v_bot AND codigo='GE-P'||lpad((20+v_i)::text,3,'0');
    v_num := next_orcamento_numero(v_bot);
    INSERT INTO erp_orcamentos (company_id, numero, edicao_liberada, cliente_id, cliente_nome, status, observacoes, total)
    VALUES (v_bot, v_num, false, v_cli.id, v_cli.nome_fantasia, 'rascunho', v_mark, 0)
    RETURNING id INTO v_orc;
    INSERT INTO erp_orcamentos_itens
      (orcamento_id, company_id, ordem, tipo_item, produto_id, produto_codigo, produto_nome, unidade, quantidade, preco_unitario, preco_custo, subtotal)
    VALUES
      (v_orc, v_bot, 0, 'produto', v_p1.id, v_p1.codigo, v_p1.nome, 'UN', (1+v_i), v_p1.preco_venda, v_p1.preco_custo_medio, round((1+v_i)*v_p1.preco_venda, 2)),
      (v_orc, v_bot, 1, 'produto', v_p2.id, v_p2.codigo, v_p2.nome, 'UN', 2,        v_p2.preco_venda, v_p2.preco_custo_medio, round(2*v_p2.preco_venda, 2));
    -- garante o total do cabeçalho independente de trigger
    UPDATE erp_orcamentos SET total = (SELECT COALESCE(sum(subtotal),0) FROM erp_orcamentos_itens WHERE orcamento_id=v_orc)
      WHERE id=v_orc;
    v_new_orc := array_append(v_new_orc, v_orc);
  END LOOP;

  -- 7 aprovados → convertidos em pedido (oficial). 3 ficam sem converter (enviado/rascunho/enviado)
  FOR v_i IN 1..7 LOOP
    UPDATE erp_orcamentos SET status='aprovado' WHERE id=v_new_orc[v_i];
    v_ped := fn_converter_orcamento_em_pedido(v_new_orc[v_i]);
    v_new_ped := array_append(v_new_ped, v_ped);
    v_conv := v_conv + 1;
  END LOOP;
  UPDATE erp_orcamentos SET status='enviado'  WHERE id=v_new_orc[8];
  UPDATE erp_orcamentos SET status='rascunho' WHERE id=v_new_orc[9];
  UPDATE erp_orcamentos SET status='enviado'  WHERE id=v_new_orc[10];

  -- 5 pedidos faturados (parcelas 1..3, vencidos e a vencer) → fn_faturar gera erp_receber + baixa estoque + CMV
  FOR v_i IN 1..5 LOOP
    v_ped := v_new_ped[v_i];
    SELECT total INTO v_total FROM erp_pedidos WHERE id=v_ped;
    v_nparc := 1 + (v_i % 3);
    FOR v_j IN 1..v_nparc LOOP
      v_vparc := round(v_total / v_nparc, 2);
      v_venc  := CURRENT_DATE + (v_j*30) - (v_i*7);   -- mistura vencidos e a vencer
      INSERT INTO erp_pedidos_parcelas (company_id, pedido_id, numero, valor, vencimento, gerar_boleto)
      VALUES (v_bot, v_ped, v_j, v_vparc, v_venc, false);
    END LOOP;
    PERFORM fn_faturar(v_ped);
    v_fat := v_fat + 1;
  END LOOP;

  -- 1 pedido cancelado (oficial) e 1 pedido aberto (não faturado)
  PERFORM fn_pedido_cancelar(v_new_ped[6], v_motivo, 'cliente desistiu (demo)');
  v_canc := 1;
  v_aberto := 1;

  -- Cotação-exemplo multi-fornecedor (jornada cotação -> comparativo -> pedido)
  PERFORM fn_demo_seed_ge_cotacao(v_bot);

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'comercial',
    'orcamentos', (SELECT count(*) FROM erp_orcamentos WHERE company_id=v_bot AND observacoes=v_mark),
    'orcamentos_por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_orcamentos WHERE company_id=v_bot AND observacoes=v_mark GROUP BY status) s),
    'pedidos', (SELECT count(*) FROM erp_pedidos WHERE company_id=v_bot AND observacoes=v_mark),
    'pedidos_por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_pedidos WHERE company_id=v_bot AND observacoes=v_mark GROUP BY status) s),
    'receber_gerado', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot
       AND pedido_id IN (SELECT id FROM erp_pedidos WHERE company_id=v_bot AND observacoes=v_mark)),
    'convertidos', v_conv, 'faturados', v_fat, 'cancelados', v_canc, 'abertos', v_aberto,
    'cotacoes_exemplo', (SELECT count(*) FROM erp_cotacoes WHERE company_id=v_bot AND observacoes='seed:ge-comercial-cotacao')
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_comercial(uuid) FROM PUBLIC, anon;
