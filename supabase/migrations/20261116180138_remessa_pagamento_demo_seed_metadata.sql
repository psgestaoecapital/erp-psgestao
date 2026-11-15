-- Jornada "Remessa de Pagamento CNAB" demonstrável no GE-DEMO (auditor_pdca_2 · RD-98 p1/p3).
-- Só DEMO (is_demo=true), sintético, ambiente homologação (arquivo NÃO transmitido), SEM credenciais/Vault.
-- Aditiva e idempotente. Nunca toca dado de cliente real (RD-69/LGPD). Sicoob = instituição financeira (RD-100 OK).
-- Code: code-desenvolvedor-3

-- 1) [RD-98 p1] Semear 1 banco de pagamento CNAB (Sicoob) em homologação, pronto p/ pagamento
--    (ativo + convênio + cap_pagamento). Guardas: empresa precisa ser DEMO e não pode já existir config igual.
INSERT INTO public.erp_banco_provider_config
  (company_id, banco_codigo, provider, ambiente, ativo, cap_pagamento,
   cooperativa, agencia, agencia_dv, conta, convenio, codigo_beneficiario, carteira, remessa_ultimo_numero)
SELECT 'b0700000-0000-4000-a000-000000000004'::uuid, '756', 'sicoob', 'homologacao', true, true,
       '0001', '0001', '0', '123456', '7654321', '12345', '1', 0
WHERE EXISTS (SELECT 1 FROM public.companies c
              WHERE c.id = 'b0700000-0000-4000-a000-000000000004' AND c.is_demo = true)
  AND NOT EXISTS (SELECT 1 FROM public.erp_banco_provider_config
                  WHERE company_id = 'b0700000-0000-4000-a000-000000000004'
                    AND provider = 'sicoob' AND ambiente = 'homologacao');

-- 2) [RD-98 p3] Origem do dado da rota: o cálculo usa estas tabelas/RPCs reais (não erp_lancamentos).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_remessa_pagamento','erp_remessa_pagamento_item','erp_banco_provider_config','erp_pagar','erp_fornecedores']::text[],
       rpcs_chamadas    = ARRAY['fn_remessa_proxima_numeracao','fn_remessa_datas_pagamento']::text[],
       estado_real      = 'pronto'
 WHERE rota = '/dashboard/financeiro/remessa-pagamento';
