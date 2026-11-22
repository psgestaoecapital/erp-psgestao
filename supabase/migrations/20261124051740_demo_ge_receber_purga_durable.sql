-- PDCA GE · /dashboard/financeiro/receber (aud8 88/95) · /balanco-patrimonial · /caixa-grupo
-- code-desenvolvedor-3 · RD-38 (provado no dado) · RD-69 (DEMO sem poluição de teste) · RD-97 (UPDATE = destrutivo → SENSÍVEL)
--
-- PROBLEMA (provado no dado, read-only, 21/11/2026): a DEMO "Comércio (GE)" (b0700000-0000-4000-a000-000000000004)
-- acumulou 30.245 títulos-lixo VIVOS em erp_receber (soma ~R$ 10 trilhões), de 3 origens de TESTE:
--   (1) 16 títulos E2E "Mensalidade E2E"/valor 9.999.999.999.999,99 (headline R$10tri);
--   (2) 30.160 títulos de carga "Contas500 antigo/pendente" (cliente "Cliente Antigo"/"Cliente Novo", R$10/título);
--   (3) ~69 títulos de aceitação ("Cliente Aceitação", "CIELO ACEITE", "Unificar duplicado", "Cliente Achado", "E2E boleto").
-- Além de 30.168 baixas vivas desse lixo (~R$ 316 mil de "realizado-fantasma").
-- As #5506/#5599 só cobriam o subconjunto (1) (valor exato + "%E2E%" + cliente_id NULL); (2) e (3) ficavam vivos e a
-- tela /receber (e /balanco-patrimonial, /caixa-grupo) seguia não-demonstrável (headline R$10tri, listas poluídas).
--
-- PROVA RD-38 (classificação dos 30.274 títulos VIVOS da DEMO GE, 21/11):
--   JUNK_purgar        = 30.245  (soma 10.000.000.445.227,53)  → assinatura de teste E NÃO legítimo
--   LEGIT_protegido    =     24  (DEMO-GE-FIN%, docs PED/DEMO, "Cliente Demo%")
--   LEGIT_realista     =      5  (seed 09/2026: "Recebimento cliente Boa Vista", "Venda balcão NF 1001 · Cliente ACME"…)
--   → o purge atinge SÓ os 30.245 JUNK; os 29 títulos legítimos de seed permanecem (prova no corpo da PR).
--
-- FIX (RD-69, durável): função de limpeza idempotente (soft-delete reversível, com cópia de segurança) que remove o
-- lixo de TESTE por assinatura — SÓ na empresa DEMO, protegendo explicitamente o seed legítimo. Chamada:
--   (a) uma vez AGORA (limpa o estado atual de produção); e
--   (b) no início de fn_demo_seed_ge_financeiro (auto-cura a cada fn_demo_reset → não re-acumula).
-- Aditiva/idempotente: reexecutar não altera nada (guardas deleted_at IS NULL). Nenhum dado de cliente real é tocado
-- (empresa é is_demo + assinatura de teste + proteção de seed). Soft-delete é rastreável e REVERSÍVEL (backup + undo no corpo da PR).
-- Faixa de segundos :40 (code-desenvolvedor-3). PR SENSÍVEL (revisao-eng-chefe) → pede a etiqueta "migration-destrutiva-autorizada".

-- ── Cópia de segurança (reversível): ids + deleted_at antigo, antes de qualquer alteração ──
CREATE TABLE IF NOT EXISTS public.erp_receber_lixo_teste_bkp_c3 (
  receber_id      uuid PRIMARY KEY,
  company_id      uuid NOT NULL,
  cliente_nome    text,
  descricao       text,
  valor           numeric,
  status          text,
  deleted_at_old  timestamptz,
  capturado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.erp_receber_baixa_lixo_teste_bkp_c3 (
  baixa_id        uuid PRIMARY KEY,
  receber_id      uuid NOT NULL,
  company_id      uuid NOT NULL,
  valor           numeric,
  data            date,
  deleted_at_old  timestamptz,
  capturado_em    timestamptz NOT NULL DEFAULT now()
);
-- Tabelas de backup são registro interno de operação: RLS ligada, sem policy permissiva, REVOKE anon (gate RLS).
ALTER TABLE public.erp_receber_lixo_teste_bkp_c3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_receber_baixa_lixo_teste_bkp_c3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_receber_lixo_teste_bkp_c3 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.erp_receber_baixa_lixo_teste_bkp_c3 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_receber_lixo_teste_bkp_c3 TO service_role;
GRANT ALL ON public.erp_receber_baixa_lixo_teste_bkp_c3 TO service_role;

-- ── Função de limpeza reutilizável: soft-delete do lixo de TESTE na DEMO GE ──
-- ci-sem-guarda: fn_demo_ge_receber_purgar_lixo_teste — função de DEMO: guarda por is_demo (nunca toca empresa real),
--                só service_role (REVOKE anon abaixo); não grava dado de empresa real, só soft-delete de lixo de teste.
CREATE OR REPLACE FUNCTION public.fn_demo_ge_receber_purgar_lixo_teste(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_tit int := 0;
  v_bx  int := 0;
BEGIN
  -- Só roda se a empresa existir E for DEMO (nunca toca empresa real nem ambiente sem a DEMO).
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.is_demo = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_ausente_ou_nao_demo');
  END IF;

  -- Conjunto-alvo: títulos VIVOS com assinatura de TESTE e que NÃO são seed legítimo.
  CREATE TEMP TABLE _lixo_c3 ON COMMIT DROP AS
  SELECT r.id
    FROM public.erp_receber r
   WHERE r.company_id = p_company
     AND r.deleted_at IS NULL
     -- proteção explícita do seed legítimo (nunca remove o seed documentado):
     AND NOT (
          COALESCE(r.descricao    ILIKE 'DEMO-GE-FIN%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Demo%', false)
       OR COALESCE(r.numero_documento, '') ~ '^(PED|DEMO)'
     )
     -- assinatura de TESTE (E2E / carga Contas500 / aceitação):
     AND (
          COALESCE(r.cliente_nome ILIKE 'Cliente E2E %', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Antigo', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Novo', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Aceita%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Cliente Achado%', false)
       OR COALESCE(r.cliente_nome ILIKE 'CIELO ACEITE%', false)
       OR COALESCE(r.cliente_nome ILIKE 'Unificar duplicado%', false)
       OR COALESCE(r.cliente_nome ILIKE 'E2E %', false)
       OR COALESCE(r.descricao    ILIKE '%E2E%', false)
       OR COALESCE(r.descricao    ILIKE 'Contas500%', false)
       OR COALESCE(r.descricao    ILIKE 'Aceita%', false)
     );

  -- Backup (idempotente) antes de alterar.
  INSERT INTO public.erp_receber_lixo_teste_bkp_c3 (receber_id, company_id, cliente_nome, descricao, valor, status, deleted_at_old)
  SELECT r.id, r.company_id, r.cliente_nome, r.descricao, r.valor, r.status, r.deleted_at
    FROM public.erp_receber r JOIN _lixo_c3 l ON l.id = r.id
  ON CONFLICT (receber_id) DO NOTHING;

  INSERT INTO public.erp_receber_baixa_lixo_teste_bkp_c3 (baixa_id, receber_id, company_id, valor, data, deleted_at_old)
  SELECT b.id, b.receber_id, b.company_id, b.valor, b.data, b.deleted_at
    FROM public.erp_receber_baixa b JOIN _lixo_c3 l ON l.id = b.receber_id
   WHERE b.deleted_at IS NULL
  ON CONFLICT (baixa_id) DO NOTHING;

  -- Soft-delete das BAIXAS vivas do lixo (para o REALIZADO parar de somar o caixa-fantasma).
  UPDATE public.erp_receber_baixa b
     SET deleted_at = now()
    FROM _lixo_c3 l
   WHERE b.receber_id = l.id
     AND b.deleted_at IS NULL;
  GET DIAGNOSTICS v_bx = ROW_COUNT;

  -- Soft-delete dos TÍTULOS de lixo.
  UPDATE public.erp_receber r
     SET deleted_at = now()
    FROM _lixo_c3 l
   WHERE r.id = l.id
     AND r.deleted_at IS NULL;
  GET DIAGNOSTICS v_tit = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'company', p_company, 'titulos_purgados', v_tit, 'baixas_purgadas', v_bx);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_demo_ge_receber_purgar_lixo_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_ge_receber_purgar_lixo_teste(uuid) TO service_role;

-- ── Limpeza ÚNICA do estado atual de produção (DEMO "Comércio (GE)") ──
DO $once$
DECLARE r jsonb;
BEGIN
  SELECT public.fn_demo_ge_receber_purgar_lixo_teste('b0700000-0000-4000-a000-000000000004') INTO r;
  RAISE NOTICE 'Purga única DEMO GE /receber: %', r;
END
$once$;

-- ── Auto-cura: fn_demo_seed_ge_financeiro chama o purge no início (superset puro do corpo vivo + 1 linha PERFORM) ──
-- Conferido com pg_get_functiondef (RD-38): idêntico à definição viva (md5 do corpo normalizado bate), exceto a linha
-- "PERFORM ... purgar_lixo_teste" logo após o bloco de RESET. A cada fn_demo_reset a DEMO GE não re-acumula lixo de teste.
-- ci-sem-guarda: fn_demo_seed_ge_financeiro — seed de DEMO: guarda por p_company<>v_bot (só a DEMO GE), só service_role.
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

  -- Auto-cura: remove o lixo de TESTE acumulado em /receber (E2E / carga Contas500 / aceitação), protegendo o seed.
  PERFORM public.fn_demo_ge_receber_purgar_lixo_teste(v_bot);

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

  -- ── RESULTADO POR NEGÓCIO: distribui a receita de demonstração entre as ──
  -- ── business_lines ATIVAS (round-robin, idempotente). Sem isto, ~toda a   ──
  -- ── receita real cai em "Sem negócio" e a jornada segmentada (venda →     ──
  -- ── receber → resultado por negócio) não é demonstrável. Casa com         ──
  -- ── fn_ge_resultado_por_negocio_calc: lower(trim(name)) = lower(ln_txt).  ──
  -- ── Só títulos de SEED documentados (prefixos estáveis); NUNCA a poluição ──
  -- ── de specs e2e (sem numero_documento) nem dado de cliente.              ──
  WITH bl AS (
    SELECT name, (row_number() OVER (ORDER BY ln_number, id)) - 1 AS idx,
           count(*) OVER () AS n
    FROM business_lines
    WHERE company_id = v_bot AND is_active
  ),
  tit AS (
    SELECT id, (row_number() OVER (ORDER BY numero_documento, id)) - 1 AS rn
    FROM erp_receber
    WHERE company_id = v_bot
      AND (numero_documento LIKE 'DEMO-GE-FIN%' OR numero_documento LIKE 'PED-ORC%')
  )
  UPDATE erp_receber r
     SET linha_negocio = bl.name, updated_at = now()
    FROM tit, bl
   WHERE r.id = tit.id
     AND bl.idx = (tit.rn % bl.n);

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
    'contratos', (SELECT count(*) FROM erp_contratos WHERE company_id=v_bot AND nome LIKE 'DEMO-GE-FIN%'),
    'renegociacoes', (SELECT count(*) FROM erp_renegociacao WHERE company_id=v_bot AND observacao LIKE 'DEMO-GE-FIN%'),
    'retiradas_socio', (SELECT count(*) FROM erp_pagar WHERE company_id=v_bot AND categoria='Retirada de sócio' AND numero_documento LIKE 'DEMO-GE-FIN%')
  );
END $function$;

-- Guarda de acesso da função de seed (idempotente; só service_role a executa, como já estava).
REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_financeiro(uuid) TO service_role;
