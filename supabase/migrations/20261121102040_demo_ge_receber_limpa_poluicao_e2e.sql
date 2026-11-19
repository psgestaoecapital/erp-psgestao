-- RD-69 / demo-fidelidade: limpa a POLUIÇÃO de E2E em Contas a receber da DEMO "Comércio (GE)".
-- Auditoria aud8 18/11 flagrou o card "Recebido" exibindo ~R$ 10 trilhões ("10.000.000.013.572,45").
-- RD-38 provado no dado: o KPI NÃO está errado — ele soma corretamente os títulos recebidos; o valor
-- vem INTEGRALMENTE de 7 títulos de teste "Mensalidade E2E <id>" com valor 9.999.999.999.999,99
-- (valor-limite do numeric usado pelos testes), status=pago, que ficaram VIVOS na empresa DEMO.
-- Total de títulos E2E vivos: 14 (7 pago = o KPI, 6 vencido, 1 cancelado) + 3 baixas.
-- Não há nenhum título bilionário NÃO-E2E vivo na DEMO (verificado). Correção = remover o lixo de teste.
--
-- ESCOPO: SÓ a empresa DEMO b0700000-0000-4000-a000-000000000004 e SÓ linhas cujo descricao marca
-- E2E (marcador inequívoco de teste; nenhum título real se chama "Mensalidade E2E ..."). Soft-delete
-- (reversível), idempotente (WHERE deleted_at IS NULL). NÃO toca dado de cliente real.

-- 1) Baixas (recebimentos) dos títulos E2E vivos → soft-delete (tira do fluxo/conciliação).
UPDATE public.erp_receber_baixa b
SET deleted_at = now()
WHERE b.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND b.deleted_at IS NULL
  AND b.receber_id IN (
    SELECT r.id FROM public.erp_receber r
    WHERE r.company_id = 'b0700000-0000-4000-a000-000000000004'
      AND r.deleted_at IS NULL
      AND r.descricao ILIKE '%E2E%'
  );

-- 2) Títulos E2E vivos → soft-delete (somem do KPI "Recebido" e da lista).
UPDATE public.erp_receber r
SET deleted_at = now()
WHERE r.company_id = 'b0700000-0000-4000-a000-000000000004'
  AND r.deleted_at IS NULL
  AND r.descricao ILIKE '%E2E%';
