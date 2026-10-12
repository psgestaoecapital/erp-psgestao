-- RD-69 / RD-70 · Seed de CONCILIAÇÃO para demonstração (chamado #38 parte 4)
--
-- Antes: nenhuma empresa demo tinha conciliação → a tela /dashboard/financeiro/conciliacao/{inbox,lote}
-- não era auditável. Aqui: (a) empresa "Demonstração · Comércio (GE)" (is_demo); (b) função reutilizável
-- fn_demo_seed_conciliacao(company) — guard is_demo fail-closed (RD-69) — que cria 2 contas bancárias,
-- 2 lotes OFX e movimentos nos 3 estados: conciliados COM vínculo (elo visível), pendentes e ignorados.
-- Idempotente (ids determinísticos por empresa; ON CONFLICT DO NOTHING). Aplicada abaixo na Comércio (GE)
-- e na Oficina, provando que serve qualquer demo.

-- ── Empresa de demonstração Comércio (GE) ─────────────────────────────────────────────────────────────
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, restrita_ps_admin)
VALUES ('b0700000-0000-4000-a000-000000000004', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Demonstração Comércio GE LTDA', 'Demonstração · Comércio (GE)', true, 'auditoria', false)
ON CONFLICT (id) DO UPDATE SET is_demo = true, nome_fantasia = EXCLUDED.nome_fantasia;

-- ── Função de seed reutilizável ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_seed_conciliacao(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_sysrole text; v_is_demo boolean;
  -- ids determinísticos por empresa (idempotência):
  v_conta_a uuid := md5(p_company::text || ':conc:conta:sicredi')::uuid;
  v_conta_b uuid := md5(p_company::text || ':conc:conta:bradesco')::uuid;
  v_lote_a  uuid := md5(p_company::text || ':conc:lote:sicredi')::uuid;
  v_lote_b  uuid := md5(p_company::text || ':conc:lote:bradesco')::uuid;
  v_r1 uuid := md5(p_company::text || ':conc:rec:1')::uuid;
  v_r2 uuid := md5(p_company::text || ':conc:rec:2')::uuid;
  v_p1 uuid := md5(p_company::text || ':conc:pag:1')::uuid;
  v_p2 uuid := md5(p_company::text || ':conc:pag:2')::uuid;
  v_m1 uuid := md5(p_company::text || ':conc:mov:1')::uuid;
  v_m2 uuid := md5(p_company::text || ':conc:mov:2')::uuid;
  v_m3 uuid := md5(p_company::text || ':conc:mov:3')::uuid;
  v_m4 uuid := md5(p_company::text || ':conc:mov:4')::uuid;
  v_m5 uuid := md5(p_company::text || ':conc:mov:5')::uuid;
  v_m6 uuid := md5(p_company::text || ':conc:mov:6')::uuid;
  v_m7 uuid := md5(p_company::text || ':conc:mov:7')::uuid;
  v_m8 uuid := md5(p_company::text || ':conc:mov:8')::uuid;
  v_d date := (now() - interval '10 days')::date;
BEGIN
  IF p_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_nulo'); END IF;
  SELECT system_role INTO v_sysrole FROM users WHERE id = auth.uid();
  IF NOT (v_interno OR coalesce(auth.role(),'') = 'service_role'
          OR coalesce(v_sysrole,'') IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RAISE EXCEPTION 'Só PS_ADMIN semeia demo' USING errcode = '42501';
  END IF;
  -- FAIL-CLOSED (RD-69): jamais semear dado fictício numa empresa real.
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = p_company;
  IF v_is_demo IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_nao_demo', 'company_id', p_company);
  END IF;
  -- já semeado? (idempotência de alto nível)
  IF EXISTS (SELECT 1 FROM conciliacao_lote WHERE id = v_lote_a) THEN
    RETURN jsonb_build_object('ok', true, 'ja_semeado', true, 'company_id', p_company);
  END IF;

  -- 2 contas bancárias (tabela do módulo de conciliação: erp_banco_contas, FK de conciliacao_lote)
  INSERT INTO erp_banco_contas (id, company_id, nome, banco, banco_codigo, agencia, conta, tipo_conta, saldo_inicial, saldo_atual, ativo, cor, principal)
  VALUES (v_conta_a, p_company, 'Conta Corrente · Sicredi', 'Sicredi', '748', '0710', '12345-6', 'corrente', 10000, 15000, true, '#00A651', true),
         (v_conta_b, p_company, 'Conta Corrente · Bradesco', 'Bradesco', '237', '1234', '98765-4', 'corrente', 8000, 6800, true, '#CC092F', false)
  ON CONFLICT (id) DO NOTHING;

  -- Títulos que serão conciliados (com vínculo)
  INSERT INTO erp_receber (id, company_id, descricao, valor, data_vencimento, conciliado, status)
  VALUES (v_r1, p_company, 'Venda balcão NF 1001 · Cliente ACME', 1250.00, v_d, false, 'aberto'),
         (v_r2, p_company, 'Recebimento cliente Boa Vista Ltda', 3400.00, v_d + 2, false, 'aberto')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO erp_pagar (id, company_id, descricao, valor, data_vencimento, conciliado, status)
  VALUES (v_p1, p_company, 'Fornecedor Distribuidora XYZ · NF 5567', 890.50, v_d + 1, false, 'aberto'),
         (v_p2, p_company, 'Aluguel loja · Imobiliária Central', 1450.00, v_d + 3, false, 'aberto')
  ON CONFLICT (id) DO NOTHING;

  -- Lote A (Sicredi, OFX)
  INSERT INTO conciliacao_lote (id, company_id, tipo, origem, nome, periodo_inicio, periodo_fim,
    conta_bancaria_id, status, arquivo_nome, arquivo_hash)
  VALUES (v_lote_a, p_company, 'bancario', 'ofx', 'Extrato Sicredi · demonstração', v_d, v_d + 5,
    v_conta_a, 'em_andamento', 'extrato-sicredi-demo.ofx', 'demo-conc-seed-v1:'||p_company::text||':a')
  ON CONFLICT (id) DO NOTHING;
  -- Lote B (Bradesco, OFX)
  INSERT INTO conciliacao_lote (id, company_id, tipo, origem, nome, periodo_inicio, periodo_fim,
    conta_bancaria_id, status, arquivo_nome, arquivo_hash)
  VALUES (v_lote_b, p_company, 'bancario', 'ofx', 'Extrato Bradesco · demonstração', v_d, v_d + 5,
    v_conta_b, 'em_andamento', 'extrato-bradesco-demo.ofx', 'demo-conc-seed-v1:'||p_company::text||':b')
  ON CONFLICT (id) DO NOTHING;

  -- Movimentos: 4 conciliados (com vínculo), 2 pendentes, 2 ignorados (tarifa)
  INSERT INTO conciliacao_movimento (id, lote_id, company_id, data_transacao, valor, descricao, natureza, status,
      id_externo, lancamento_tabela, lancamento_id, match_origem, match_aplicado_em)
  VALUES
    (v_m1, v_lote_a, p_company, v_d,     1250.00, 'TED RECEBIDA CLIENTE ACME',        'credito', 'conciliado', 'OFX-A-001', 'erp_receber', v_r1, 'manual', now()),
    (v_m2, v_lote_a, p_company, v_d + 2, 3400.00, 'PIX RECEBIDO BOA VISTA LTDA',       'credito', 'conciliado', 'OFX-A-002', 'erp_receber', v_r2, 'manual', now()),
    (v_m3, v_lote_a, p_company, v_d + 1,  890.50, 'PAGAMENTO FORNECEDOR XYZ',          'debito',  'conciliado', 'OFX-A-003', 'erp_pagar',  v_p1, 'manual', now()),
    (v_m4, v_lote_a, p_company, v_d + 3,  500.00, 'DEPOSITO EM DINHEIRO',              'credito', 'pendente',   'OFX-A-004', NULL, NULL, NULL, NULL),
    (v_m5, v_lote_a, p_company, v_d + 4,   32.90, 'TARIFA PACOTE DE SERVICOS',         'debito',  'ignorado',   'OFX-A-005', NULL, NULL, NULL, NULL),
    (v_m6, v_lote_b, p_company, v_d + 3, 1450.00, 'PAGAMENTO ALUGUEL IMOB CENTRAL',    'debito',  'conciliado', 'OFX-B-001', 'erp_pagar',  v_p2, 'manual', now()),
    (v_m7, v_lote_b, p_company, v_d + 4, 1200.00, 'COMPRA CARTAO DEBITO ATACADO',      'debito',  'pendente',   'OFX-B-002', NULL, NULL, NULL, NULL),
    (v_m8, v_lote_b, p_company, v_d + 5,   15.00, 'TARIFA TED',                        'debito',  'ignorado',   'OFX-B-003', NULL, NULL, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Vínculos (o "elo" que o auditor precisa ver) — só título (erp_receber/erp_pagar).
  INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_em)
  VALUES (v_m1, p_company, 'erp_receber', v_r1, 1250.00, now()),
         (v_m2, p_company, 'erp_receber', v_r2, 3400.00, now()),
         (v_m3, p_company, 'erp_pagar',   v_p1,  890.50, now()),
         (v_m6, p_company, 'erp_pagar',   v_p2, 1450.00, now())
  ON CONFLICT DO NOTHING;

  -- Baixa dos títulos conciliados (origem conciliação)
  UPDATE erp_receber SET status='pago', valor_pago=valor, data_pagamento=data_vencimento,
    conciliado=true, movimento_banco_id = CASE id WHEN v_r1 THEN v_m1 ELSE v_m2 END,
    origem_baixa='conciliacao', updated_at=now()
   WHERE id IN (v_r1, v_r2);
  UPDATE erp_pagar SET status='pago', valor_pago=valor, data_pagamento=data_vencimento,
    conciliado=true, movimento_banco_id = CASE id WHEN v_p1 THEN v_m3 ELSE v_m6 END,
    origem_baixa='conciliacao', updated_at=now()
   WHERE id IN (v_p1, v_p2);

  -- Totais dos lotes
  UPDATE conciliacao_lote l SET
    total_movimentos = (SELECT count(*) FROM conciliacao_movimento m WHERE m.lote_id=l.id),
    total_valor      = (SELECT coalesce(sum(abs(valor)),0) FROM conciliacao_movimento m WHERE m.lote_id=l.id),
    total_conciliados= (SELECT count(*) FROM conciliacao_movimento m WHERE m.lote_id=l.id AND m.status='conciliado'),
    total_pendentes  = (SELECT count(*) FROM conciliacao_movimento m WHERE m.lote_id=l.id AND m.status='pendente'),
    total_ignorados  = (SELECT count(*) FROM conciliacao_movimento m WHERE m.lote_id=l.id AND m.status='ignorado'),
    updated_at = now()
   WHERE l.id IN (v_lote_a, v_lote_b);

  RETURN jsonb_build_object('ok', true, 'company_id', p_company,
    'contas', 2, 'lotes', 2, 'conciliados', 4, 'pendentes', 2, 'ignorados', 2, 'vinculos', 4);
END; $$;

COMMENT ON FUNCTION public.fn_demo_seed_conciliacao(uuid) IS
  'RD-69/RD-70: seed idempotente de conciliação (2 contas, 2 lotes OFX, conciliados+vínculo/pendentes/ignorados) só em empresa is_demo.';
REVOKE ALL ON FUNCTION public.fn_demo_seed_conciliacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_conciliacao(uuid) TO authenticated, service_role;

-- ── Aplica nas duas demos ────────────────────────────────────────────────────────────────────────────
SELECT public.fn_demo_seed_conciliacao('b0700000-0000-4000-a000-000000000004'); -- Comércio (GE)
SELECT public.fn_demo_seed_conciliacao('b0700000-0000-4000-a000-000000000001'); -- Oficina
