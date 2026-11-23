-- PDCA GE · /dashboard/financeiro/caixa-grupo (gap do auditor: conciliação bancária
-- indisponível na tela — colunas BANCO (EXTRATO) e DIFERENÇA sem valor)
-- Code: code-desenvolvedor-3
--
-- Problema: a caixa-grupo lê erp_banco_contas.saldo_extrato para as colunas "Banco (extrato)"
-- e "Diferença". O seed fn_demo_seed_ge_bancos cria as 2 contas DEMO-GE mas NUNCA preenchia
-- saldo_extrato, então a conta-corrente sempre aparecia como "— sem extrato" / "—" e a
-- conciliação não podia ser demonstrada (critério c/e do auditor). Fora da tela a reconstrução
-- do extrato tem de viver no PRÓPRIO seed: o reset DEMO apaga e recria as contas, logo um
-- UPDATE avulso seria perdido no próximo fn_demo_reset.
--
-- AÇÃO (DEMO-only, guardado por p_company = b0700000-…004; early-return para qualquer outra
-- empresa — não toca núcleo nem dado de cliente): a conta-corrente DEMO-GE passa a nascer com
-- saldo_extrato = saldo conciliado do dia (16030,00), saldo_extrato_em = fim do período do lote
-- (recente, não "velho") e origem "Extrato OFX · DEMO-GE". A conta "Caixa interno" segue sem
-- extrato de propósito (caixa físico não tem extrato bancário). Assim BANCO (EXTRATO) e
-- DIFERENÇA passam a mostrar valor e a conciliação fica demonstrável.
--
-- CREATE OR REPLACE de função existente (idêntica à viva, só a 1ª INSERT da conta-corrente muda).
-- RD-38: provado em BEGIN…ROLLBACK que, após rodar o seed na empresa DEMO, a conta-corrente fica
-- com saldo_extrato preenchido e a caixa-grupo deixa de mostrar "— sem extrato" nessa conta.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_bancos(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_conta_cc uuid; v_conta_caixa uuid; v_lote uuid;
  v_rec_id uuid; v_rec_val numeric; v_pag_id uuid; v_pag_val numeric;
  v_cnab_id uuid; v_cnab_val numeric;
  v_mov_rec uuid; v_mov_pag uuid; v_mov_cnab uuid;
  v_pi date := (date_trunc('month', CURRENT_DATE) - interval '30 days')::date;
  v_pf date := CURRENT_DATE;
-- ci-sem-guarda: fn_demo_seed_ge_bancos — seed DEMO-only, service_role-only (REVOKE authenticated/anon),
-- grava exclusivamente na empresa DEMO-GE fixa b0700000-…-004 após early-return abaixo (p_company <> v_bot).
-- fn__guarda_empresa confere acesso do USUÁRIO corrente e não se aplica a seed de serviço do fn_demo_reset.
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;

  -- ── RESET idempotente e determinístico (FK-safe) ──
  -- A empresa é 100% demo (is_demo/auditoria): sua conciliação e suas contas bancárias são
  -- inteiramente deste seed. Reset por company_id (não por marcador) absorve qualquer legado
  -- pré-seed-único (ex.: lotes "Extrato Bradesco/Sicredi · demonstração" feitos à mão).
  -- Ordem FK-safe: desfaz carimbo nos títulos → vínculo → movimento → lote → contas.
  UPDATE erp_receber SET conciliado=false, movimento_banco_id=NULL, conta_bancaria_id=NULL
    WHERE company_id=v_bot AND (conciliado OR movimento_banco_id IS NOT NULL OR conta_bancaria_id IS NOT NULL);
  UPDATE erp_pagar SET conciliado=false, movimento_banco_id=NULL
    WHERE company_id=v_bot AND (conciliado OR movimento_banco_id IS NOT NULL);
  DELETE FROM conciliacao_vinculo   WHERE company_id=v_bot;
  DELETE FROM conciliacao_movimento WHERE company_id=v_bot;
  DELETE FROM conciliacao_lote      WHERE company_id=v_bot;
  DELETE FROM erp_banco_contas      WHERE company_id=v_bot;

  -- ── 2 contas bancárias (erp_banco_contas — tabela canônica) ──
  -- Conta-corrente nasce COM saldo do extrato (OFX) para a caixa-grupo demonstrar a conciliação:
  -- Banco (extrato) = 16030,00 (saldo conciliado do dia), em data recente, origem rotulada.
  INSERT INTO erp_banco_contas (company_id, nome, banco, banco_codigo, agencia, conta, tipo_conta, saldo_inicial, saldo_atual, ativo, principal, saldo_extrato, saldo_extrato_em, saldo_extrato_origem)
  VALUES (v_bot, 'DEMO-GE Conta Corrente', 'Itaú Unibanco', '341', '1234', '56789-0', 'corrente', 15000.00, 18250.00, true, false, 16030.00, v_pf::timestamptz, 'Extrato OFX · DEMO-GE')
  RETURNING id INTO v_conta_cc;
  -- Caixa interno não tem extrato bancário (fica "— sem extrato" de propósito).
  INSERT INTO erp_banco_contas (company_id, nome, banco, agencia, conta, tipo_conta, saldo_inicial, saldo_atual, ativo, principal)
  VALUES (v_bot, 'DEMO-GE Caixa', 'Caixa interno', NULL, NULL, 'caixa', 500.00, 730.00, true, false)
  RETURNING id INTO v_conta_caixa;

  -- ── títulos de referência (do bloco financeiro) p/ conciliação ──
  SELECT id, COALESCE(valor_pago, valor) INTO v_rec_id, v_rec_val
    FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND status='pago'
    ORDER BY numero_documento LIMIT 1;
  SELECT id, COALESCE(valor_pago, valor) INTO v_pag_id, v_pag_val
    FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND status='pago'
    ORDER BY numero_documento LIMIT 1;

  -- ── CNAB (retorno): baixa um a-pagar em aberto pela RPC oficial com origem_baixa='retorno_cnab' ──
  SELECT id, valor INTO v_cnab_id, v_cnab_val
    FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN-P%' AND status='aberto'
      AND (v_pag_id IS NULL OR id <> v_pag_id)
    ORDER BY numero_documento LIMIT 1;
  IF v_cnab_id IS NOT NULL THEN
    PERFORM fn_pagar_baixar_pagamento(v_cnab_id, CURRENT_DATE - 3, NULL, 'boleto', NULL, 'retorno_cnab');
  END IF;

  -- ── 1 lote de extrato OFX (bancário) ──
  INSERT INTO conciliacao_lote (company_id, tipo, origem, nome, arquivo_nome, conta_bancaria_id,
    periodo_inicio, periodo_fim, total_movimentos, total_valor, total_conciliados, total_pendentes, total_ignorados, status)
  VALUES (v_bot, 'bancario', 'ofx', 'DEMO-GE Extrato bancário (OFX)', 'DEMO-GE-BANCO-extrato.ofx', v_conta_cc,
    v_pi, v_pf, 0, 0, 0, 0, 0, 'em_andamento')
  RETURNING id INTO v_lote;

  -- movimento CONCILIADO (crédito → recebimento baixado)
  IF v_rec_id IS NOT NULL THEN
    INSERT INTO conciliacao_movimento (lote_id, company_id, data_transacao, valor, descricao, natureza,
      status, lancamento_tabela, lancamento_id, match_origem, match_aplicado_em)
    VALUES (v_lote, v_bot, v_pf - 10, v_rec_val, 'PIX RECEBIDO CLIENTE DEMO', 'credito',
      'conciliado', 'erp_receber', v_rec_id, 'manual', now())
    RETURNING id INTO v_mov_rec;
    INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado)
    VALUES (v_mov_rec, v_bot, 'erp_receber', v_rec_id, v_rec_val);
    UPDATE erp_receber SET conciliado=true, movimento_banco_id=v_mov_rec, conta_bancaria_id=v_conta_cc WHERE id=v_rec_id;
  END IF;

  -- movimento CONCILIADO (débito → pagamento baixado por PIX)
  IF v_pag_id IS NOT NULL THEN
    INSERT INTO conciliacao_movimento (lote_id, company_id, data_transacao, valor, descricao, natureza,
      status, lancamento_tabela, lancamento_id, match_origem, match_aplicado_em)
    VALUES (v_lote, v_bot, v_pf - 9, v_pag_val, 'PIX ENVIADO FORNECEDOR DEMO', 'debito',
      'conciliado', 'erp_pagar', v_pag_id, 'manual', now())
    RETURNING id INTO v_mov_pag;
    INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado)
    VALUES (v_mov_pag, v_bot, 'erp_pagar', v_pag_id, v_pag_val);
    UPDATE erp_pagar SET conciliado=true, movimento_banco_id=v_mov_pag WHERE id=v_pag_id;
  END IF;

  -- movimento CONCILIADO (débito → RETORNO CNAB: boleto pago via arquivo de retorno)
  IF v_cnab_id IS NOT NULL THEN
    INSERT INTO conciliacao_movimento (lote_id, company_id, data_transacao, valor, descricao, natureza,
      status, lancamento_tabela, lancamento_id, match_origem, match_aplicado_em)
    VALUES (v_lote, v_bot, v_pf - 3, v_cnab_val, 'RETORNO CNAB - LIQUIDACAO BOLETO', 'debito',
      'conciliado', 'erp_pagar', v_cnab_id, 'retorno_cnab', now())
    RETURNING id INTO v_mov_cnab;
    INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado)
    VALUES (v_mov_cnab, v_bot, 'erp_pagar', v_cnab_id, v_cnab_val);
    UPDATE erp_pagar SET conciliado=true, movimento_banco_id=v_mov_cnab WHERE id=v_cnab_id;
  END IF;

  -- 1 movimento IGNORADO (tarifa bancária, sem contrapartida)
  INSERT INTO conciliacao_movimento (lote_id, company_id, data_transacao, valor, descricao, natureza, status, motivo_status)
  VALUES (v_lote, v_bot, v_pf - 8, 29.90, 'TARIFA PACOTE DE SERVICOS', 'debito', 'ignorado', 'Tarifa bancária — sem lançamento');

  -- 3 movimentos PENDENTES (aguardando match)
  INSERT INTO conciliacao_movimento (lote_id, company_id, data_transacao, valor, descricao, natureza, status)
  VALUES
    (v_lote, v_bot, v_pf - 6, 1280.00, 'TED RECEBIDA CLIENTE', 'credito', 'pendente'),
    (v_lote, v_bot, v_pf - 4,  540.00, 'COMPRA CARTAO DEBITO MATERIAL', 'debito', 'pendente'),
    (v_lote, v_bot, v_pf - 2,  212.35, 'BOLETO CONCESSIONARIA ENERGIA', 'debito', 'pendente');

  -- totais do lote (como as RPCs recalculam)
  UPDATE conciliacao_lote l SET
    total_movimentos = (SELECT count(*) FROM conciliacao_movimento WHERE lote_id=l.id),
    total_valor      = (SELECT COALESCE(sum(valor),0) FROM conciliacao_movimento WHERE lote_id=l.id),
    total_conciliados= (SELECT count(*) FROM conciliacao_movimento WHERE lote_id=l.id AND status='conciliado'),
    total_pendentes  = (SELECT count(*) FROM conciliacao_movimento WHERE lote_id=l.id AND status='pendente'),
    total_ignorados  = (SELECT count(*) FROM conciliacao_movimento WHERE lote_id=l.id AND status='ignorado'),
    updated_at = now()
  WHERE l.id=v_lote;

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'bancos',
    'contas', (SELECT count(*) FROM erp_banco_contas WHERE company_id=v_bot AND nome LIKE 'DEMO-GE%'),
    'lotes', (SELECT count(*) FROM conciliacao_lote WHERE company_id=v_bot AND nome LIKE 'DEMO-GE%'),
    'movimentos', (SELECT count(*) FROM conciliacao_movimento WHERE company_id=v_bot AND lote_id=v_lote),
    'movimentos_por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM conciliacao_movimento WHERE lote_id=v_lote GROUP BY status) s),
    'vinculos', (SELECT count(*) FROM conciliacao_vinculo WHERE company_id=v_bot AND movimento_id IN
       (SELECT id FROM conciliacao_movimento WHERE lote_id=v_lote)),
    'titulos_conciliados', jsonb_build_object(
       'receber', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND conciliado),
       'pagar',   (SELECT count(*) FROM erp_pagar   WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND conciliado)),
    'cnab_retorno', jsonb_build_object(
       'titulo_baixado', (v_cnab_id IS NOT NULL),
       'origem_baixa', (SELECT origem_baixa FROM erp_pagar WHERE id=v_cnab_id),
       'valor', v_cnab_val)
  );
END $function$;

-- ── Segurança (check:fn-guards · revoke_anon) — casa a ACL viva (service_role-only) ──
REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_bancos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_bancos(uuid) TO service_role;
