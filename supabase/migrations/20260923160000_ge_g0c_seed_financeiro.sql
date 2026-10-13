-- GE · Onda G0c · Demonstração Comércio GE — FINANCEIRO (Bloco 3 do seed, RD-69).
-- Sub-seed fn_demo_seed_ge_financeiro(company) encadeado no braço 004 do fn_demo_reset,
-- após cadastros (G0a) e comercial (G0b). Só a empresa demo, SECURITY DEFINER + REVOKE anon.
--
-- Conteúdo (6 meses; competência=data_emissao/data_competencia, caixa=data_pagamento):
--   contas a RECEBER e a PAGAR — recorrentes, parceladas (parcela_grupo_id + n/total), com
--   juros/multa, baixas PARCIAIS (via RPC oficial), vencidas e a vencer; 2 contratos recorrentes
--   (receita + despesa); 1 renegociação (2 títulos vencidos → 2 boletos novos); retiradas de sócio.
--
-- Caminho: as RPCs de CRIAÇÃO de título (fn_*_criar_com_parcelas_v2) exigem assinatura ativa e
-- guardam por get_user_company_ids() SEM escape de service_role — inutilizáveis por um seed via
-- cron. Idem fn_contrato_recorrencia_criar / fn_renegociacao_criar (só member/is_admin). Por isso
-- os títulos/contratos/renegociação são inseridos direto no seed replicando a MESMA forma do v2
-- (parcela_grupo_id, parcela n/total, data_competencia) — como o próprio fn_faturar insere erp_receber.
-- Já a BAIXA usa a RPC oficial fn_receber_baixar_pagamento / fn_pagar_baixar_pagamento (tem escape
-- service_role/jwt-vazio/is_admin): baixa parcial real, valor_pago, status, origem_baixa, trilha.
-- Idempotente por marcador (numero_documento/nome/observacao 'DEMO-GE-FIN%').

CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_financeiro(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_cli uuid; v_cli_nome text; v_forn uuid; v_forn_nome text;
  v_m int; v_emissao date; v_venc date; v_comp date; v_val numeric; v_id uuid;
  v_grp uuid; v_r4 uuid; v_r5 uuid; v_reneg uuid; v_conta uuid;
  v_ct1 uuid; v_ct2 uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;

  SELECT id, nome_fantasia INTO v_cli, v_cli_nome FROM erp_clientes WHERE company_id=v_bot ORDER BY created_at, id LIMIT 1;
  SELECT id, nome_fantasia INTO v_forn, v_forn_nome FROM erp_fornecedores WHERE company_id=v_bot ORDER BY created_at, id LIMIT 1;

  -- ── RESET idempotente (FK-safe; erp_receber/pagar são docs financeiros → escape) ──
  -- FK-safe: renegociacao_origem (refs reneg+receber) → receber/pagar (receber refs reneg) → renegociacao → contratos
  DELETE FROM erp_renegociacao_origem WHERE company_id=v_bot
    AND renegociacao_id IN (SELECT id FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%');
  PERFORM set_config('app.permitir_delete_fisico','on',true);
  DELETE FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%';
  DELETE FROM erp_pagar   WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%';
  PERFORM set_config('app.permitir_delete_fisico','off',true);
  DELETE FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%';
  DELETE FROM erp_contratos WHERE company_id=v_bot AND nome LIKE 'DEMO-GE-FIN%';

  -- ── RECEBER: 6 títulos mensais (recorrência alternada), competência+vencimento espalhados ──
  FOR v_m IN 0..5 LOOP
    v_emissao := CURRENT_DATE - (v_m*30);
    v_venc    := CASE WHEN v_m=0 THEN CURRENT_DATE + 30 ELSE v_emissao + 30 END;  -- v_m=0 a vencer; demais no passado
    v_comp    := date_trunc('month', v_emissao)::date;
    v_val     := round(900 + v_m*130, 2);
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor,
      status, categoria, numero_documento, descricao, parcela, data_competencia,
      recorrente, recorrencia_meses, juros, multa, created_at)
    VALUES (v_bot, v_cli, v_cli_nome, v_emissao, v_venc, v_val,
      'aberto', 'Receita de vendas', 'DEMO-GE-FIN-R'||v_m, 'Recebimento de demonstração', '1/1', v_comp,
      (v_m % 2 = 0), CASE WHEN v_m % 2 = 0 THEN 1 ELSE NULL END,
      CASE WHEN v_m=3 THEN 12 ELSE 0 END, CASE WHEN v_m=3 THEN 8 ELSE 0 END, now())
    RETURNING id INTO v_id;
    IF v_m = 1 THEN PERFORM fn_receber_baixar_pagamento(v_id, v_venc, NULL, 'PIX', NULL, 'manual'); END IF;        -- pago
    IF v_m = 2 THEN PERFORM fn_receber_baixar_pagamento(v_id, v_venc, NULL, 'PIX', round(v_val*0.4,2), 'manual'); END IF; -- parcial
    IF v_m = 4 THEN v_r4 := v_id; END IF;   -- fica vencido p/ renegociação
    IF v_m = 5 THEN v_r5 := v_id; END IF;
  END LOOP;

  -- ── RECEBER parcelado: 3 parcelas (parcela_grupo_id), a vencer ──
  v_grp := gen_random_uuid();
  FOR v_m IN 1..3 LOOP
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor,
      status, categoria, numero_documento, descricao, parcela, parcela_grupo_id, data_competencia, created_at)
    VALUES (v_bot, v_cli, v_cli_nome, CURRENT_DATE, CURRENT_DATE + (v_m*30), 500.00,
      'aberto', 'Receita de vendas', 'DEMO-GE-FIN-RP'||v_m, 'Venda parcelada de demonstração',
      v_m||'/3', v_grp, date_trunc('month', CURRENT_DATE)::date, now());
  END LOOP;

  -- ── PAGAR: 6 títulos mensais (recorrência alternada), juros/multa num vencido ──
  FOR v_m IN 0..5 LOOP
    v_emissao := CURRENT_DATE - (v_m*30);
    v_venc    := CASE WHEN v_m=0 THEN CURRENT_DATE + 20 ELSE v_emissao + 30 END;
    v_comp    := date_trunc('month', v_emissao)::date;
    v_val     := round(400 + v_m*90, 2);
    INSERT INTO erp_pagar (company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento, valor,
      status, categoria, numero_documento, descricao, parcela, data_competencia,
      recorrente, recorrencia_meses, juros, multa, created_at)
    VALUES (v_bot, v_forn, v_forn_nome, v_emissao, v_venc, v_val,
      'aberto', 'Fornecedores', 'DEMO-GE-FIN-P'||v_m, 'Despesa de demonstração', '1/1', v_comp,
      (v_m % 2 = 1), CASE WHEN v_m % 2 = 1 THEN 1 ELSE NULL END,
      CASE WHEN v_m=3 THEN 9 ELSE 0 END, CASE WHEN v_m=3 THEN 6 ELSE 0 END, now())
    RETURNING id INTO v_id;
    IF v_m = 1 THEN PERFORM fn_pagar_baixar_pagamento(v_id, v_venc, NULL, 'PIX', NULL, 'manual'); END IF;        -- pago
    IF v_m = 2 THEN PERFORM fn_pagar_baixar_pagamento(v_id, v_venc, NULL, 'PIX', round(v_val*0.5,2), 'manual'); END IF; -- parcial
  END LOOP;

  -- ── PAGAR parcelado: 3 parcelas ──
  v_grp := gen_random_uuid();
  FOR v_m IN 1..3 LOOP
    INSERT INTO erp_pagar (company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento, valor,
      status, categoria, numero_documento, descricao, parcela, parcela_grupo_id, data_competencia, created_at)
    VALUES (v_bot, v_forn, v_forn_nome, CURRENT_DATE, CURRENT_DATE + (v_m*30), 300.00,
      'aberto', 'Fornecedores', 'DEMO-GE-FIN-PP'||v_m, 'Compra parcelada de demonstração',
      v_m||'/3', v_grp, date_trunc('month', CURRENT_DATE)::date, now());
  END LOOP;

  -- ── Retiradas de sócio (despesa, categoria própria) ──
  FOR v_m IN 1..2 LOOP
    INSERT INTO erp_pagar (company_id, data_emissao, data_vencimento, data_pagamento, valor_pago, valor, status, categoria,
      numero_documento, descricao, parcela, data_competencia, origem_baixa, created_at)
    VALUES (v_bot, CURRENT_DATE - (v_m*30), CURRENT_DATE - (v_m*30), CURRENT_DATE - (v_m*30), round(2500 + v_m*500,2),
      round(2500 + v_m*500,2), 'pago',
      'Retirada de sócio', 'DEMO-GE-FIN-SOCIO'||v_m, 'Retirada de sócio (pró-labore/distribuição)', '1/1',
      date_trunc('month', CURRENT_DATE - (v_m*30))::date, 'manual', now());
  END LOOP;

  -- ── 2 contratos recorrentes (receita + despesa) ──
  INSERT INTO erp_contratos (company_id, numero, nome, valor_mensal, data_inicio, natureza, tipo, cliente_id, cliente_nome, descricao, dia_vencimento, status)
  VALUES (v_bot, next_contrato_numero(v_bot), 'DEMO-GE-FIN Mensalidade de serviço', 1200.00, CURRENT_DATE - 150, 'receita', 'mensalidade', v_cli, v_cli_nome, 'Contrato recorrente de demonstração (receita)', 10, 'ativo')
  RETURNING id INTO v_ct1;
  INSERT INTO erp_contratos (company_id, numero, nome, valor_mensal, data_inicio, natureza, tipo, descricao, dia_vencimento, status)
  VALUES (v_bot, next_contrato_numero(v_bot), 'DEMO-GE-FIN BPO financeiro', 800.00, CURRENT_DATE - 120, 'despesa', 'servico', 'Contrato recorrente de demonstração (despesa)', 5, 'ativo')
  RETURNING id INTO v_ct2;

  -- ── 1 renegociação: 2 títulos vencidos (R4+R5) viram 2 boletos novos ──
  IF v_r4 IS NOT NULL AND v_r5 IS NOT NULL THEN
    v_val := (SELECT COALESCE(sum(valor),0) FROM erp_receber WHERE id IN (v_r4, v_r5));
    INSERT INTO erp_renegociacao (company_id, cliente_id, data_acerto, valor_origem, valor_gerado, ajuste, status, observacao)
    VALUES (v_bot, v_cli, CURRENT_DATE - 5, v_val, round(v_val*1.05,2), round(v_val*0.05,2), 'confirmada', 'DEMO-GE-FIN renegociação de demonstração')
    RETURNING id INTO v_reneg;
    INSERT INTO erp_renegociacao_origem (company_id, renegociacao_id, receber_origem_id, valor)
      SELECT v_bot, v_reneg, id, valor FROM erp_receber WHERE id IN (v_r4, v_r5);
    UPDATE erp_receber SET status='renegociado', renegociacao_id=v_reneg, em_renegociacao=true, updated_at=now()
      WHERE id IN (v_r4, v_r5);
    FOR v_m IN 1..2 LOOP
      INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor,
        status, categoria, numero_documento, descricao, parcela, renegociacao_id, data_competencia, created_at)
      VALUES (v_bot, v_cli, v_cli_nome, CURRENT_DATE - 5, CURRENT_DATE + (v_m*30), round(v_val*1.05/2,2),
        'aberto', 'Receita de vendas', 'DEMO-GE-FIN-RN'||v_m, 'Boleto renegociado de demonstração',
        v_m||'/2', v_reneg, date_trunc('month', CURRENT_DATE)::date, now());
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'financeiro',
    'receber', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%'),
    'receber_por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' GROUP BY status) s),
    'pagar', (SELECT count(*) FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%'),
    'pagar_por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' GROUP BY status) s),
    'parciais', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND status='parcial')
              + (SELECT count(*) FROM erp_pagar   WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND status='parcial'),
    'vencidos_a_vencer', jsonb_build_object(
       'receber_vencidos', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND status IN ('aberto','parcial') AND data_vencimento < CURRENT_DATE),
       'receber_a_vencer', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND status IN ('aberto','parcial') AND data_vencimento >= CURRENT_DATE)),
    'contratos', (SELECT count(*) FROM erp_contratos WHERE company_id=v_bot AND nome LIKE 'DEMO-GE-FIN%'),
    'renegociacoes', (SELECT count(*) FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%'),
    'retiradas_socio', (SELECT count(*) FROM erp_pagar WHERE company_id=v_bot AND categoria='Retirada de sócio' AND numero_documento LIKE 'DEMO-GE-FIN%')
  );
END $function$;

-- fn_demo_reset: no braço 004, encadeia o financeiro (Bloco 3) após cadastros + comercial.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb; v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb;
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
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid)              TO authenticated, service_role;
