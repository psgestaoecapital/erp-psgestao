-- Jornada 4 do CEO (rateio por centro de custo -> resultado por negócio -> DRE por divisão
-- -> fluxo divisional). Rota: /dashboard/gestao-empresarial/resultado-por-negocio.
-- Code: code-desenvolvedor-3
--
-- PROBLEMA (auditor_pdca_2 / aud8, RD-38 provado no dado 22-23/11, DEMO GE
-- b0700000-…-004): a receita/despesa viva da DEMO-GE caía quase toda em "Sem negócio"
-- porque os títulos de seed não tinham linha_negocio (business line) nem centro_custo_id.
-- fn_ge_resultado_por_negocio_calc casa receita por business_lines.name (= linha_negocio)
-- e despesa por centro_custo texto -> cost_center_map. Sem classificação, a jornada 4 não
-- é demonstrável ponta a ponta e o resultado-por-negócio mostra só "sem negócio".
--
-- AÇÃO (NÚCLEO/DEMO-only, idempotente, no fn_demo_reset da GE DEMO):
--  (A) CREATE OR REPLACE de fn_demo_seed_ge_financeiro (idêntica à viva; só o bloco de
--      classificação muda) para que TODO reset deixe os títulos de seed classificados:
--      - receber: linha_negocio round-robin nas business_lines ATIVAS (receita por divisão);
--      - pagar mensais (DEMO-GE-FIN-P0..5): custo direto alternado COMERCIAL/PROJETO_X
--        (os 2 centros mapeados em cost_center_map -> linhas Comercial/Geral); parcelados e
--        retiradas ficam ADMIN -> pool comum, rateado por receita;
--      - centro_custo_id canônico (erp_centros_custo) a partir do centro_custo texto, nas
--        duas tabelas.
--  (B) Backfill ÚNICO e idempotente (aditivo, sem apagar/alterar valor de título): aplica a
--      MESMA classificação aos títulos de seed JÁ existentes na DEMO-GE, para a jornada ficar
--      demonstrável AGORA, sem esperar o próximo fn_demo_reset.
--
-- COORDENAÇÃO com a purga durável do lixo E2E (#5747): toca SÓ títulos de seed documentados
-- (prefixos DEMO-GE-FIN% / PED-ORC%), NUNCA lixo E2E (sem numero_documento) nem dado de
-- cliente. Valores permanecem intactos (classificação só preenche linha_negocio/centro_custo).
--
-- RD-38 (BEGIN…ROLLBACK, DEMO ...004): após classificar, fn_ge_resultado_por_negocio_calc
-- retorna 5 negócios (Geral/Comercial/Varejo/Atacado/Serviços) com receita sã (R$),
-- pct_rateio somando 100% e sem_negocio.receita = 0 — nada de E2E/poison.

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) Função de seed (reset-safe): classificação enriquecida no próprio seed
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_financeiro(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: fn_demo_seed_ge_financeiro — seed DEMO-only, service_role-only (REVOKE
-- authenticated/anon), grava exclusivamente na empresa DEMO-GE fixa b0700000-…-004 após o
-- early-return abaixo (p_company <> v_bot). fn__guarda_empresa confere acesso do USUÁRIO
-- corrente e não se aplica a seed de serviço chamado pelo fn_demo_reset.
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

  -- Auto-cura (RD-52 fonte única: esta é a versão SUPERSET de fn_demo_seed_ge_financeiro, que aplica por ÚLTIMO):
  -- limpa o lixo de TESTE acumulado em /receber e /pagar (E2E / carga Contas500 / aceitação), protegendo o seed.
  -- Mescla as chamadas da #5929 (auto-cura) com o rateio desta PR, para que a última definição não perca nenhum dos dois.
  PERFORM public.fn_demo_ge_receber_purgar_lixo_teste(v_bot);
  -- O purge de /pagar nasce na migration da #5929 (…140540). Esta migration aplica depois dela; o to_regprocedure
  -- apenas evita erro de runtime caso o seed seja invocado numa janela em que a #5929 ainda não esteja na main.
  IF to_regprocedure('public.fn_demo_ge_pagar_purgar_lixo_teste(uuid)') IS NOT NULL THEN
    PERFORM public.fn_demo_ge_pagar_purgar_lixo_teste(v_bot);
  END IF;

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

  -- ── RESULTADO POR NEGÓCIO / RATEIO POR CENTRO DE CUSTO (idempotente) ──
  -- Sem isto a receita/despesa cai em "Sem negócio" e a jornada 4 (venda → receber →
  -- resultado por negócio → DRE por divisão → fluxo) não é demonstrável. Casa com
  -- fn_ge_resultado_por_negocio_calc: receita por lower(name)=lower(linha_negocio);
  -- despesa por centro_custo texto → cost_center_map. Só títulos de SEED documentados
  -- (prefixos estáveis); NUNCA poluição de specs e2e nem dado de cliente.

  -- (1) pagar mensais: custo direto alternado COMERCIAL/PROJETO_X (os 2 centros mapeados em
  --     cost_center_map → linhas Comercial/Geral). Parcelados/retiradas ficam ADMIN → pool
  --     comum, rateado por receita. Dá custo direto a >1 divisão, não só a Geral.
  WITH t AS (
    SELECT id, (row_number() OVER (ORDER BY numero_documento, id)) - 1 AS rn
    FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN-P_'
  )
  UPDATE erp_pagar p
     SET centro_custo = CASE WHEN t.rn % 2 = 0 THEN 'PROJETO_X' ELSE 'COMERCIAL' END, updated_at = now()
    FROM t WHERE p.id = t.id;

  -- (2) receber: linha_negocio round-robin nas business_lines ativas (receita por divisão)
  WITH bl AS (
    SELECT name, (row_number() OVER (ORDER BY ln_number, id)) - 1 AS idx, count(*) OVER () AS n
    FROM business_lines WHERE company_id = v_bot AND is_active
  ),
  tit AS (
    SELECT id, (row_number() OVER (ORDER BY numero_documento, id)) - 1 AS rn
    FROM erp_receber
    WHERE company_id = v_bot AND (numero_documento LIKE 'DEMO-GE-FIN%' OR numero_documento LIKE 'PED-ORC%')
  )
  UPDATE erp_receber r
     SET linha_negocio = bl.name, updated_at = now()
    FROM tit, bl WHERE r.id = tit.id AND bl.idx = (tit.rn % bl.n);

  -- (3) centro_custo_id canônico a partir do centro_custo texto (ambas as tabelas)
  UPDATE erp_receber r SET centro_custo_id = cc.id, updated_at = now()
    FROM erp_centros_custo cc
   WHERE r.company_id = v_bot AND cc.company_id = v_bot AND r.numero_documento LIKE 'DEMO-GE-FIN%'
     AND coalesce(r.centro_custo,'') <> '' AND cc.codigo = r.centro_custo
     AND r.centro_custo_id IS DISTINCT FROM cc.id;
  UPDATE erp_pagar p SET centro_custo_id = cc.id, updated_at = now()
    FROM erp_centros_custo cc
   WHERE p.company_id = v_bot AND cc.company_id = v_bot AND p.numero_documento LIKE 'DEMO-GE-FIN%'
     AND coalesce(p.centro_custo,'') <> '' AND cc.codigo = p.centro_custo
     AND p.centro_custo_id IS DISTINCT FROM cc.id;

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
    'receber_segmentado', (SELECT jsonb_object_agg(coalesce(linha_negocio,'(sem negócio)'), n) FROM
       (SELECT linha_negocio, count(*) n FROM erp_receber WHERE company_id=v_bot
          AND (numero_documento LIKE 'DEMO-GE-FIN%' OR numero_documento LIKE 'PED-ORC%') GROUP BY linha_negocio) s),
    'centros_custo', (SELECT jsonb_object_agg(cc, n) FROM
       (SELECT centro_custo cc, count(*) n FROM (
          SELECT centro_custo FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND coalesce(centro_custo,'')<>''
          UNION ALL
          SELECT centro_custo FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND coalesce(centro_custo,'')<>''
        ) z GROUP BY centro_custo) s),
    'centro_custo_id_set', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND centro_custo_id IS NOT NULL)
                         + (SELECT count(*) FROM erp_pagar   WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN%' AND centro_custo_id IS NOT NULL),
    'contratos', (SELECT count(*) FROM erp_contratos WHERE company_id=v_bot AND nome LIKE 'DEMO-GE-FIN%'),
    'renegociacoes', (SELECT count(*) FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%'),
    'retiradas_socio', (SELECT count(*) FROM erp_pagar WHERE company_id=v_bot AND categoria='Retirada de sócio' AND numero_documento LIKE 'DEMO-GE-FIN%')
  );
END $function$;

-- Segurança (check:fn-guards · revoke_anon) — casa a ACL viva (service_role-only)
REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) Backfill ÚNICO e idempotente na DEMO-GE existente (aditivo: só classifica,
--     nunca apaga/altera valor). Deixa a jornada 4 demonstrável AGORA, sem esperar
--     o próximo fn_demo_reset. Guardado pela empresa DEMO fixa + prefixos de seed.
-- ─────────────────────────────────────────────────────────────────────────────
DO $backfill$
DECLARE v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
BEGIN
  -- Só roda se a empresa DEMO-GE existe (ambientes sem a DEMO ficam intactos).
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_bot) THEN RETURN; END IF;

  WITH t AS (
    SELECT id, (row_number() OVER (ORDER BY numero_documento, id)) - 1 AS rn
    FROM erp_pagar WHERE company_id=v_bot AND numero_documento LIKE 'DEMO-GE-FIN-P_'
  )
  UPDATE erp_pagar p
     SET centro_custo = CASE WHEN t.rn % 2 = 0 THEN 'PROJETO_X' ELSE 'COMERCIAL' END, updated_at = now()
    FROM t WHERE p.id = t.id
     AND p.centro_custo IS DISTINCT FROM (CASE WHEN t.rn % 2 = 0 THEN 'PROJETO_X' ELSE 'COMERCIAL' END);

  WITH bl AS (
    SELECT name, (row_number() OVER (ORDER BY ln_number, id)) - 1 AS idx, count(*) OVER () AS n
    FROM business_lines WHERE company_id = v_bot AND is_active
  ),
  tit AS (
    SELECT id, (row_number() OVER (ORDER BY numero_documento, id)) - 1 AS rn
    FROM erp_receber
    WHERE company_id = v_bot AND (numero_documento LIKE 'DEMO-GE-FIN%' OR numero_documento LIKE 'PED-ORC%')
  )
  UPDATE erp_receber r
     SET linha_negocio = bl.name, updated_at = now()
    FROM tit, bl WHERE r.id = tit.id AND bl.idx = (tit.rn % bl.n)
     AND r.linha_negocio IS DISTINCT FROM bl.name;

  UPDATE erp_receber r SET centro_custo_id = cc.id, updated_at = now()
    FROM erp_centros_custo cc
   WHERE r.company_id = v_bot AND cc.company_id = v_bot AND r.numero_documento LIKE 'DEMO-GE-FIN%'
     AND coalesce(r.centro_custo,'') <> '' AND cc.codigo = r.centro_custo
     AND r.centro_custo_id IS DISTINCT FROM cc.id;
  UPDATE erp_pagar p SET centro_custo_id = cc.id, updated_at = now()
    FROM erp_centros_custo cc
   WHERE p.company_id = v_bot AND cc.company_id = v_bot AND p.numero_documento LIKE 'DEMO-GE-FIN%'
     AND coalesce(p.centro_custo,'') <> '' AND cc.codigo = p.centro_custo
     AND p.centro_custo_id IS DISTINCT FROM cc.id;
END $backfill$;
