-- GE · Onda G0d · Demonstração Comércio GE — BANCOS/CONCILIAÇÃO/CNAB (Bloco 4 do seed, RD-69).
-- Sub-seed fn_demo_seed_ge_bancos(company) encadeado no braço 004 do fn_demo_reset,
-- após cadastros (G0a) + comercial (G0b) + financeiro (G0c). Só a empresa demo,
-- SECURITY DEFINER + REVOKE anon, 100% fictício, idempotente por marcador.
--
-- Conteúdo:
--   • 2 contas bancárias (corrente + caixa) — tabela canônica erp_banco_contas (alvo dos FKs);
--   • 1 lote de extrato OFX (conciliacao_lote origem='ofx', tipo='bancario') com movimentos
--     cobrindo os 3 estados: CONCILIADO com vínculo, IGNORADO (tarifa) e PENDENTE (sem match);
--   • CNAB representado como RETORNO conciliado: um título a pagar é baixado pela RPC oficial com
--     origem_baixa='retorno_cnab' e casado a um movimento do extrato (match_origem='retorno_cnab').
--
-- Por que NÃO grava erp_remessa_pagamento: a trava trg_bloqueia_emissao_demo
-- (fn_bloqueia_emissao_nao_produtiva) proíbe emissão real — NF-e, NFS-e e remessa CNAB — em empresa
-- de auditoria (ambiente_tenant<>'producao'). É a MESMA trava pela qual o G0b faturou sem gravar nota.
-- Decisão do CEO (23/09): manter a trava intacta e representar o CNAB pelo lado do RETORNO
-- (extrato + baixa origem_baixa='retorno_cnab' + conciliação), que fecha o ciclo com o financeiro.
--
-- Caminho: as RPCs de conciliação guardam por get_user_company_ids() SEM escape de service_role —
-- inutilizáveis por um seed via cron. Por isso movimentos/vínculos são inseridos DIRETO replicando a
-- forma que as RPCs gravam. Já a BAIXA do título CNAB usa a RPC oficial fn_pagar_baixar_pagamento
-- (tem escape service_role/jwt-vazio/is_admin). Idempotente por marcador (contas 'DEMO-GE%'; lote 'DEMO-GE%').

CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_bancos(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_conta_cc uuid; v_conta_caixa uuid; v_lote uuid;
  v_rec_id uuid; v_rec_val numeric; v_pag_id uuid; v_pag_val numeric;
  v_cnab_id uuid; v_cnab_val numeric;
  v_mov_rec uuid; v_mov_pag uuid; v_mov_cnab uuid;
  v_pi date := (date_trunc('month', CURRENT_DATE) - interval '30 days')::date;
  v_pf date := CURRENT_DATE;
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

-- fn_demo_reset: no braço 004, encadeia bancos (Bloco 4) após cadastros + comercial + financeiro.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb; v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_fin := fn_demo_seed_ge_financeiro(p_company_id);
    v_ban := fn_demo_seed_ge_bancos(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_bancos(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_bancos(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid)          TO authenticated, service_role;
