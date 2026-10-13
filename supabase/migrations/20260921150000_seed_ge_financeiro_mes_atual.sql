-- Item 5 (combinado) · Demonstração Comércio (GE): 3 receber + 3 pagar no MÊS CORRENTE.
--
-- A tela /financeiro/receber|pagar abre por padrão no mês atual. Os títulos que já existiam na demo GE
-- ficam fora do mês corrente → a tela abre vazia (e o auditor lia como "não assentou"). Semear alguns
-- títulos do mês atual dá conteúdo real para a auditoria. Guard fail-closed por is_demo (nunca cliente),
-- idempotente (ids determinísticos), datas relativas a now() (sempre no mês em que rodar).

-- ── 3 a receber ───────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_receber (id, company_id, descricao, valor, data_emissao, data_vencimento, status, conciliado)
SELECT x.id, c.id, x.descricao, x.valor,
       date_trunc('month', now())::date,
       (date_trunc('month', now())::date + x.venc_offset), x.status, false
FROM (VALUES
  (md5('b0700000-0000-4000-a000-000000000004:seed:rec:1')::uuid, 'Mensalidade — Cliente Aurora Ltda',  1200.00, 4,  'aberto'),
  (md5('b0700000-0000-4000-a000-000000000004:seed:rec:2')::uuid, 'Serviço avulso — Boa Vista Comércio',  850.00, 11, 'aberto'),
  (md5('b0700000-0000-4000-a000-000000000004:seed:rec:3')::uuid, 'Recebimento — Delta Distribuidora',    2500.00, 2,  'pago')
) AS x(id, descricao, valor, venc_offset, status)
CROSS JOIN public.companies c
WHERE c.id = 'b0700000-0000-4000-a000-000000000004' AND c.is_demo = true
ON CONFLICT (id) DO NOTHING;

-- fecha o título 'pago' (valor_pago + data_pagamento) — coerência com o status
UPDATE public.erp_receber
SET valor_pago = valor, data_pagamento = (date_trunc('month', now())::date + 2)
WHERE id = md5('b0700000-0000-4000-a000-000000000004:seed:rec:3')::uuid AND status = 'pago' AND valor_pago IS NULL;

-- ── 3 a pagar ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_pagar (id, company_id, descricao, valor, data_emissao, data_vencimento, status, conciliado)
SELECT x.id, c.id, x.descricao, x.valor,
       date_trunc('month', now())::date,
       (date_trunc('month', now())::date + x.venc_offset), x.status, false
FROM (VALUES
  (md5('b0700000-0000-4000-a000-000000000004:seed:pag:1')::uuid, 'Fornecedor — Insumos ABC',        950.00, 7,  'aberto'),
  (md5('b0700000-0000-4000-a000-000000000004:seed:pag:2')::uuid, 'Energia elétrica — distribuidora', 640.00, 10, 'aberto'),
  (md5('b0700000-0000-4000-a000-000000000004:seed:pag:3')::uuid, 'Aluguel do mês',                  1800.00, 1,  'pago')
) AS x(id, descricao, valor, venc_offset, status)
CROSS JOIN public.companies c
WHERE c.id = 'b0700000-0000-4000-a000-000000000004' AND c.is_demo = true
ON CONFLICT (id) DO NOTHING;

UPDATE public.erp_pagar
SET valor_pago = valor, data_pagamento = (date_trunc('month', now())::date + 1)
WHERE id = md5('b0700000-0000-4000-a000-000000000004:seed:pag:3')::uuid AND status = 'pago' AND valor_pago IS NULL;
