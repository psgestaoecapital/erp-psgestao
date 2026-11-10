-- DEMO GE Comércio (b07..004): popular centro_custo nos lançamentos financeiros VIVOS,
-- para a tela /dashboard/cadastros/centros-custo (fn_centro_custo_valores) deixar de aparecer
-- MORTA (RD-98 p1) e a jornada centro de custo -> rateio -> resultado por negócio -> DRE
-- demonstrar ponta a ponta.
--
-- Diagnóstico (RD-38, auditor_pdca_2 10/11): fn_demo_seed_ge_financeiro insere 6+3 receber e
-- 6+3+2 pagar VIVOS, mas NENHUM com centro_custo (0 menções na função). fn_centro_custo_valores
-- lê erp_pagar/erp_receber vivos com centro_custo<>'' -> retornava vazio.
--
-- Esta migração:
--  1) CREATE OR REPLACE fn_demo_seed_ge_financeiro com centro_custo nos lançamentos (persiste a
--     cada fn_demo_reset): receita -> COMERCIAL; despesa mensal -> PROJETO_X; parcelada e retirada
--     de sócio -> ADMIN.
--  2) UPDATE único e idempotente dos lançamentos DEMO-GE-FIN% VIVOS que ainda estão sem centro_custo
--     (popula AGORA, sem esperar o próximo reset). SÓ empresa DEMO (is_demo), mesmo critério.
--
-- Segurança: só toca a empresa DEMO b07..004 (is_demo). Não altera valor/status/pago — só grava a
-- TAG de centro de custo (classificação). Nenhum dado de cliente real é tocado. Função mantém
-- SECURITY DEFINER e a trava `IF p_company <> v_bot` do DEMO.

-- 1) Seed atualizado -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_financeiro(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  DELETE FROM erp_renegociacao_origem WHERE company_id=v_bot
    AND renegociacao_id IN (SELECT id FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%');
  PERFORM set_config('app.permitir_delete_fisico','on',true);
  DELETE FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%';
  DELETE FROM erp_pagar   WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%';
  PERFORM set_config('app.permitir_delete_fisico','off',true);
  DELETE FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%';
  DELETE FROM erp_contratos WHERE company_id=v_bot AND nome LIKE 'DEMO-GE-FIN%';

  -- ── RECEBER: 6 títulos mensais (recorrência alternada) — centro COMERCIAL ──
  FOR v_m IN 0..5 LOOP
    v_emissao := CURRENT_DATE - (v_m*30);
    v_venc    := CASE WHEN v_m=0 THEN CURRENT_DATE + 30 ELSE v_emissao + 30 END;
    v_comp    := date_trunc('month', v_emissao)::date;
    v_val     := round(900 + v_m*130, 2);
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor,
      status, categoria, centro_custo, numero_documento, descricao, parcela, data_competencia,
      recorrente, recorrencia_meses, juros, multa, created_at)
    VALUES (v_bot, v_cli, v_cli_nome, v_emissao, v_venc, v_val,
      'aberto', 'Receita de vendas', 'COMERCIAL', 'DEMO-GE-FIN-R'||v_m, 'Recebimento de demonstração', '1/1', v_comp,
      (v_m % 2 = 0), CASE WHEN v_m % 2 = 0 THEN 1 ELSE NULL END,
      CASE WHEN v_m=3 THEN 12 ELSE 0 END, CASE WHEN v_m=3 THEN 8 ELSE 0 END, now())
    RETURNING id INTO v_id;
    IF v_m = 1 THEN PERFORM fn_receber_baixar_pagamento(v_id, v_venc, NULL, 'PIX', NULL, 'manual'); END IF;
    IF v_m = 2 THEN PERFORM fn_receber_baixar_pagamento(v_id, v_venc, NULL, 'PIX', round(v_val*0.4,2), 'manual'); END IF;
    IF v_m = 4 THEN v_r4 := v_id; END IF;
    IF v_m = 5 THEN v_r5 := v_id; END IF;
  END LOOP;

  -- ── RECEBER parcelado: 3 parcelas — centro COMERCIAL ──
  v_grp := gen_random_uuid();
  FOR v_m IN 1..3 LOOP
    INSERT INTO erp_receber (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor,
      status, categoria, centro_custo, numero_documento, descricao, parcela, parcela_grupo_id, data_competencia, created_at)
    VALUES (v_bot, v_cli, v_cli_nome, CURRENT_DATE, CURRENT_DATE + (v_m*30), 500.00,
      'aberto', 'Receita de vendas', 'COMERCIAL', 'DEMO-GE-FIN-RP'||v_m, 'Venda parcelada de demonstração',
      v_m||'/3', v_grp, date_trunc('month', CURRENT_DATE)::date, now());
  END LOOP;

  -- ── PAGAR: 6 títulos mensais (recorrência alternada) — centro PROJETO_X ──
  FOR v_m IN 0..5 LOOP
    v_emissao := CURRENT_DATE - (v_m*30);
    v_venc    := CASE WHEN v_m=0 THEN CURRENT_DATE + 20 ELSE v_emissao + 30 END;
    v_comp    := date_trunc('month', v_emissao)::date;
    v_val     := round(400 + v_m*90, 2);
    INSERT INTO erp_pagar (company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento, valor,
      status, categoria, centro_custo, numero_documento, descricao, parcela, data_competencia,
      recorrente, recorrencia_meses, juros, multa, created_at)
    VALUES (v_bot, v_forn, v_forn_nome, v_emissao, v_venc, v_val,
      'aberto', 'Fornecedores', 'PROJETO_X', 'DEMO-GE-FIN-P'||v_m, 'Despesa de demonstração', '1/1', v_comp,
      (v_m % 2 = 1), CASE WHEN v_m % 2 = 1 THEN 1 ELSE NULL END,
      CASE WHEN v_m=3 THEN 9 ELSE 0 END, CASE WHEN v_m=3 THEN 6 ELSE 0 END, now())
    RETURNING id INTO v_id;
    IF v_m = 1 THEN PERFORM fn_pagar_baixar_pagamento(v_id, v_venc, NULL, 'PIX', NULL, 'manual'); END IF;
    IF v_m = 2 THEN PERFORM fn_pagar_baixar_pagamento(v_id, v_venc, NULL, 'PIX', round(v_val*0.5,2), 'manual'); END IF;
  END LOOP;

  -- ── PAGAR parcelado: 3 parcelas — centro ADMIN ──
  v_grp := gen_random_uuid();
  FOR v_m IN 1..3 LOOP
    INSERT INTO erp_pagar (company_id, fornecedor_id, fornecedor_nome, data_emissao, data_vencimento, valor,
      status, categoria, centro_custo, numero_documento, descricao, parcela, parcela_grupo_id, data_competencia, created_at)
    VALUES (v_bot, v_forn, v_forn_nome, CURRENT_DATE, CURRENT_DATE + (v_m*30), 300.00,
      'aberto', 'Fornecedores', 'ADMIN', 'DEMO-GE-FIN-PP'||v_m, 'Compra parcelada de demonstração',
      v_m||'/3', v_grp, date_trunc('month', CURRENT_DATE)::date, now());
  END LOOP;

  -- ── Retiradas de sócio (despesa, categoria própria) — centro ADMIN ──
  FOR v_m IN 1..2 LOOP
    INSERT INTO erp_pagar (company_id, data_emissao, data_vencimento, data_pagamento, valor_pago, valor, status, categoria,
      centro_custo, numero_documento, descricao, parcela, data_competencia, origem_baixa, created_at)
    VALUES (v_bot, CURRENT_DATE - (v_m*30), CURRENT_DATE - (v_m*30), CURRENT_DATE - (v_m*30), round(2500 + v_m*500,2),
      round(2500 + v_m*500,2), 'pago',
      'Retirada de sócio', 'ADMIN', 'DEMO-GE-FIN-SOCIO'||v_m, 'Retirada de sócio (pró-labore/distribuição)', '1/1',
      date_trunc('month', CURRENT_DATE - (v_m*30))::date, 'manual', now());
  END LOOP;

  -- ── 2 contratos recorrentes (receita + despesa) ──
  INSERT INTO erp_contratos (company_id, numero, nome, valor_mensal, data_inicio, natureza, tipo, cliente_id, cliente_nome, descricao, dia_vencimento, status)
  VALUES (v_bot, next_contrato_numero(v_bot), 'DEMO-GE-FIN Mensalidade de serviço', 1200.00, CURRENT_DATE - 150, 'receita', 'mensalidade', v_cli, v_cli_nome, 'Contrato recorrente de demonstração (receita)', 10, 'ativo')
  RETURNING id INTO v_ct1;
  INSERT INTO erp_contratos (company_id, numero, nome, valor_mensal, data_inicio, natureza, tipo, descricao, dia_vencimento, status)
  VALUES (v_bot, next_contrato_numero(v_bot), 'DEMO-GE-FIN BPO financeiro', 800.00, CURRENT_DATE - 120, 'despesa', 'servico', 'Contrato recorrente de demonstração (despesa)', 5, 'ativo')
  RETURNING id INTO v_ct2;

  -- ── 1 renegociação: 2 títulos vencidos (R4+R5) viram 2 boletos novos — centro COMERCIAL ──
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
        status, categoria, centro_custo, numero_documento, descricao, parcela, renegociacao_id, data_competencia, created_at)
      VALUES (v_bot, v_cli, v_cli_nome, CURRENT_DATE - 5, CURRENT_DATE + (v_m*30), round(v_val*1.05/2,2),
        'aberto', 'Receita de vendas', 'COMERCIAL', 'DEMO-GE-FIN-RN'||v_m, 'Boleto renegociado de demonstração',
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
    'centros_custo', (SELECT jsonb_object_agg(cc, n) FROM
       (SELECT centro_custo cc, count(*) n FROM (
          SELECT centro_custo FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND coalesce(centro_custo,'')<>''
          UNION ALL
          SELECT centro_custo FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND coalesce(centro_custo,'')<>''
        ) z GROUP BY centro_custo) s),
    'contratos', (SELECT count(*) FROM erp_contratos WHERE company_id=v_bot AND nome LIKE 'DEMO-GE-FIN%'),
    'renegociacoes', (SELECT count(*) FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%'),
    'retiradas_socio', (SELECT count(*) FROM erp_pagar WHERE company_id=v_bot AND categoria='Retirada de sócio' AND numero_documento LIKE 'DEMO-GE-FIN%')
  );
END $function$;

-- 2) Backfill único e idempotente dos lançamentos VIVOS já existentes (SÓ DEMO) --------
DO $pop$
DECLARE v_bot uuid := 'b0700000-0000-4000-a000-000000000004'; v_r int; v_p int;
BEGIN
  -- confirma que é empresa DEMO antes de tocar qualquer linha
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id=v_bot AND is_demo=true) THEN
    RAISE NOTICE 'empresa % nao e DEMO; backfill ignorado', v_bot; RETURN;
  END IF;

  UPDATE erp_receber SET centro_custo='COMERCIAL', updated_at=now()
   WHERE company_id=v_bot AND deleted_at IS NULL AND numero_documento LIKE 'DEMO-GE-FIN%'
     AND coalesce(centro_custo,'')='';
  GET DIAGNOSTICS v_r = ROW_COUNT;

  UPDATE erp_pagar SET centro_custo = CASE
      WHEN numero_documento LIKE 'DEMO-GE-FIN-PP%' THEN 'ADMIN'
      WHEN numero_documento LIKE 'DEMO-GE-FIN-SOCIO%' THEN 'ADMIN'
      ELSE 'PROJETO_X' END,
     updated_at=now()
   WHERE company_id=v_bot AND deleted_at IS NULL AND numero_documento LIKE 'DEMO-GE-FIN%'
     AND coalesce(centro_custo,'')='';
  GET DIAGNOSTICS v_p = ROW_COUNT;

  RAISE NOTICE 'Backfill centro_custo DEMO GE: receber %, pagar %', v_r, v_p;
END
$pop$;

-- Permissões / guardas (check:fn-guards) ---------------------------------------
-- Função de SEED DEMO: trava por `IF p_company <> v_bot` (só a empresa DEMO fixa b07..004) e roda
-- sob service_role no fn_demo_reset, SEM auth.uid() — por isso NÃO chama fn__guarda_empresa (exigiria
-- usuário logado e quebraria o reset). Fica fechada a anon/PUBLIC, igual ao ACL vivo (service_role).
-- ci-sem-guarda: fn_demo_seed_ge_financeiro — seed DEMO travado em v_bot, roda sob service_role sem auth.uid no fn_demo_reset
REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) TO service_role;
