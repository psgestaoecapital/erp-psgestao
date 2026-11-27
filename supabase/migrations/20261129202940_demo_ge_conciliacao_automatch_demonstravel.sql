-- GE · DEMO · Conciliação (/dashboard/financeiro/conciliacao/inbox) — tornar o AUTO-MATCH demonstrável.
-- Origem: auditor_pdca_2 (PDCA jornada, RD-38). A jornada de conciliação funciona ponta a ponta pelo
-- caminho MANUAL, mas o diferencial premium (sugestão automática de match por valor/data/forma) aparecia
-- ZERADO na DEMO GE: os 3 movimentos OFX pendentes do seed não casavam com NENHUM título aberto, então
-- fn_conciliacao_sugerir_match devolvia 0 sugestões e o avaliador nunca via a sugestão "perfeita".
--
-- O MOTOR está correto e conservador (não sugere match fraco que baixaria dinheiro errado) — NÃO é tocado.
-- Correção é 100% de SEED, SÓ-DEMO (company_id = b0700000-…-004, is_demo): acrescenta 2 títulos ABERTOS que
-- casam por VALOR + DATA + FORMA com 2 dos 3 movimentos pendentes, mantendo o 3º SEM par (caminho manual):
--   • TED RECEBIDA CLIENTE  (crédito, R$ 1.280,00) → erp_receber aberto 1.280,00, mesma data, forma 'TED';
--   • BOLETO CONCESSIONARIA ENERGIA (débito, R$ 212,35) → erp_pagar aberto 212,35, mesma data, forma 'boleto';
--   • COMPRA CARTAO DEBITO MATERIAL (R$ 540,00) continua SEM par → exibe o caminho manual.
-- Pela régua do motor (valor exato +50, data ±1 +30, forma casada +25) cada par pontua ~105 → "perfeito".
--
-- Idempotente: os 2 títulos têm marcador numero_documento 'DEMO-GE-CONC%' e são removidos no RESET do seed
-- (escape app.permitir_delete_fisico, como o bloco financeiro). Aditivo, não altera o motor, não toca dado de
-- cliente real, sem DDL de estrutura. Faixa de migration do code-desenvolvedor-3 (segundos :40).

CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_bancos(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_conta_cc uuid; v_conta_caixa uuid; v_lote uuid;
  v_rec_id uuid; v_rec_val numeric; v_pag_id uuid; v_pag_val numeric;
  v_cnab_id uuid; v_cnab_val numeric;
  v_mov_rec uuid; v_mov_pag uuid; v_mov_cnab uuid;
  v_cli uuid; v_cli_nome text; v_forn uuid; v_forn_nome text;
  v_conc_rec uuid; v_conc_pag uuid;
  v_pi date := (date_trunc('month', CURRENT_DATE) - interval '30 days')::date;
  v_pf date := CURRENT_DATE;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;
  -- ci-sem-guarda: fn_demo_seed_ge_bancos — só a empresa de demonstração fixa da GE (b0700000-…-004, is_demo); guarda explícita acima (fail-closed p_company <> v_bot) garante que só escreve na DEMO; sem GRANT a anon, roda pelo fn_demo_reset (service_role).

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

  -- títulos-isca da conciliação (só-demo): remoção física idempotente (escape, como o bloco financeiro)
  PERFORM set_config('app.permitir_delete_fisico','on',true);
  DELETE FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-CONC%';
  DELETE FROM erp_pagar   WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-CONC%';
  PERFORM set_config('app.permitir_delete_fisico','off',true);

  -- ── 2 contas bancárias (erp_banco_contas — tabela canônica) ──
  INSERT INTO erp_banco_contas (company_id, nome, banco, banco_codigo, agencia, conta, tipo_conta, saldo_inicial, saldo_atual, ativo, principal)
  VALUES (v_bot, 'DEMO-GE Conta Corrente', 'Itaú Unibanco', '341', '1234', '56789-0', 'corrente', 15000.00, 18250.00, true, false)
  RETURNING id INTO v_conta_cc;
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

  -- contraparte (cliente/fornecedor demo) p/ os títulos-isca de auto-match
  SELECT id, nome_fantasia INTO v_cli, v_cli_nome FROM erp_clientes WHERE company_id=v_bot ORDER BY created_at, id LIMIT 1;
  SELECT id, nome_fantasia INTO v_forn, v_forn_nome FROM erp_fornecedores WHERE company_id=v_bot ORDER BY created_at, id LIMIT 1;

  -- ── CNAB (retorno): baixa um a-pagar em aberto pela RPC oficial com origem_baixa='retorno_cnab' ──
  SELECT id, valor INTO v_cnab_id, v_cnab_val
    FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN-P%' AND status='aberto'
      AND (v_pag_id IS NULL OR id <> v_pag_id)
    ORDER BY numero_documento LIMIT 1;
  IF v_cnab_id IS NOT NULL THEN
    PERFORM fn_pagar_baixar_pagamento(v_cnab_id, CURRENT_DATE - 3, NULL, 'boleto', NULL, 'retorno_cnab');
  END IF;

  -- ── títulos-isca ABERTOS que tornam o auto-match demonstrável (casam valor+data+forma) ──
  -- RECEBER: casa com o movimento "TED RECEBIDA CLIENTE" (crédito, R$ 1.280,00, data v_pf-6).
  INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor,
    status, categoria, numero_documento, descricao, parcela, data_competencia, forma_pagamento, created_at)
  VALUES (v_bot, v_cli, COALESCE(v_cli_nome,'Cliente demonstração'), v_pf - 6, v_pf - 6, 1280.00,
    'aberto', 'Receita de vendas', 'DEMO-GE-CONC-R1', 'TED a receber de cliente (aguardando conciliação)',
    '1/1', date_trunc('month', (v_pf - 6)::date)::date, 'TED', now())
  RETURNING id INTO v_conc_rec;

  -- PAGAR: casa com o movimento "BOLETO CONCESSIONARIA ENERGIA" (débito, R$ 212,35, data v_pf-2).
  INSERT INTO erp_pagar (company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento, valor,
    status, categoria, numero_documento, descricao, parcela, data_competencia, forma_pagamento, created_at)
  VALUES (v_bot, v_forn, COALESCE(v_forn_nome,'Concessionária de energia (demonstração)'), v_pf - 2, v_pf - 2, 212.35,
    'aberto', 'Fornecedores', 'DEMO-GE-CONC-P1', 'Boleto de energia (aguardando conciliação)',
    '1/1', date_trunc('month', (v_pf - 2)::date)::date, 'boleto', now())
  RETURNING id INTO v_conc_pag;

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

  -- 3 movimentos PENDENTES (aguardando match): 2 com título-isca aberto (auto-match perfeito), 1 sem par (manual)
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
    'auto_match_iscas', jsonb_build_object(
       'receber_1280', (v_conc_rec IS NOT NULL),
       'pagar_212_35', (v_conc_pag IS NOT NULL),
       'abertos', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-CONC%' AND status='aberto')
                + (SELECT count(*) FROM erp_pagar   WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-CONC%' AND status='aberto')),
    'cnab_retorno', jsonb_build_object(
       'titulo_baixado', (v_cnab_id IS NOT NULL),
       'origem_baixa', (SELECT origem_baixa FROM erp_pagar WHERE id=v_cnab_id),
       'valor', v_cnab_val)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_bancos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_bancos(uuid) TO authenticated, service_role;
