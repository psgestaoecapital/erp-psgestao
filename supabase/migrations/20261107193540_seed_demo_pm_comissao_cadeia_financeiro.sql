-- PDCA P&M · /dashboard/pm/comissao — a DEMO passa a EXERCITAR a cadeia comissão → financeiro
-- Reauditoria auditor_pdca_2 (07/11): o código da cadeia está completo e provado
-- (fn_agency_comissao_aprovar cria erp_pagar "aberto" + grava lancamento_id;
--  fn_agency_comissao_marcar_paga liquida o erp_pagar pela via canônica).
-- MAS a DEMO b0700000-0000-4000-a000-000000000002 tinha as 9 comissões semeadas direto
-- no status final com lancamento_id = NULL — nunca passaram por aprovar/marcar_paga. Consequência:
--   * as 3 "a_pagar" não tinham erp_pagar correspondente (não apareciam em Contas a Pagar);
--   * as 3 "paga" não tinham erp_pagar "pago" (a conciliação "comissão paga liquida o a pagar"
--     não se demonstrava na tela).
--
-- Este seed é DEMO-only, ADITIVO e IDEMPOTENTE: só age em comissões da empresa DEMO cujo
-- lancamento_id ainda é NULL. Espelha EXATAMENTE o efeito das RPCs canônicas (sem bypassar
-- regra de negócio — a migration roda como owner, sem auth.uid(), então não pode chamar as
-- RPCs guardadas por empresa; reproduz o mesmo resultado que elas produzem):
--   * para "a_pagar" e "paga": cria o erp_pagar (categoria "Comissões", linha_negocio
--     "pm_comercial", status "aberto") e grava lancamento_id — igual a fn_agency_comissao_aprovar;
--   * para "paga": liquida o erp_pagar (valor_pago = valor, status "pago", data_pagamento) —
--     igual à baixa canônica de fn_agency_comissao_marcar_paga → fn_pagar_registrar_pagamento.
-- NUNCA toca dado de cliente nem título já pago; as "prevista" ficam intactas (sem erp_pagar,
-- como no fluxo real — só nascem no financeiro ao serem aprovadas).
--
-- PROVA RD-38 (contagem ANTES → DEPOIS, DEMO b0700000-...-0002):
--   ANTES:  a_pagar=3 (lancamento NULL, 0 erp_pagar) · paga=3 (0 erp_pagar) · prevista=3
--   DEPOIS: a_pagar=3 → 3 erp_pagar "aberto" · paga=3 → 3 erp_pagar "pago" · prevista=3 (intacta)
-- (validado em BEGIN/ROLLBACK com statement_timeout curto antes deste PR).

DO $$
DECLARE
  r       record;
  v_pagar uuid;
  v_vend  text;
  v_comp  uuid := 'b0700000-0000-4000-a000-000000000002';
BEGIN
  -- Só a empresa DEMO existe? (o banco de testes pode não ter a DEMO; sai sem erro)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_comp) THEN
    RAISE NOTICE 'seed comissao: empresa DEMO % ausente, nada a fazer', v_comp;
    RETURN;
  END IF;

  FOR r IN
    SELECT *
    FROM agency_comissao
    WHERE company_id = v_comp
      AND deleted_em IS NULL
      AND lancamento_id IS NULL
      AND status IN ('a_pagar', 'paga')
  LOOP
    SELECT COALESCE(full_name, email) INTO v_vend FROM users WHERE id = r.vendedor_id;

    -- Espelha fn_agency_comissao_aprovar: cria o erp_pagar "aberto" e linka a comissão.
    INSERT INTO erp_pagar (company_id, descricao, categoria, valor, data_vencimento, status,
                           linha_negocio, observacoes)
    VALUES (v_comp,
            'Comissão comercial' || COALESCE(' · ' || v_vend, ''),
            'Comissões',
            COALESCE(r.valor_comissao, 0),
            GREATEST(COALESCE(r.competencia, current_date), current_date),
            'aberto',
            'pm_comercial',
            'Comissão comercial (DEMO · cadeia comissão→financeiro)')
    RETURNING id INTO v_pagar;

    UPDATE agency_comissao SET lancamento_id = v_pagar WHERE id = r.id;

    -- Para as já "paga": liquida o erp_pagar (igual à baixa canônica da marcar_paga).
    IF r.status = 'paga' THEN
      UPDATE erp_pagar
         SET valor_pago     = COALESCE(r.valor_comissao, 0),
             status         = 'pago',
             data_pagamento = COALESCE(r.paga_em::date, current_date),
             forma_pagamento = 'PIX',
             updated_at     = now()
       WHERE id = v_pagar;
    END IF;
  END LOOP;
END $$;
