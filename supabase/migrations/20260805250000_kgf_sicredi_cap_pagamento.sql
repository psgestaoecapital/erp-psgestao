-- RD-41 · KGF Autocenter (a462e13f) — liga o perfil de PAGAMENTO do Sicredi (banco 748).
-- O provider Sicredi da KGF já existe (cobrança: cap_boleto=true), mas cap_pagamento=false. Com o motor
-- CNAB 240 pagamento Sicredi (segmento J) provado byte a byte contra o arquivo real 6YT63101
-- (scripts/cnab-mapear-proof-sicredi.ts: build + corpo J52 = 0 divergências), liberamos a remessa de
-- pagamento de boletos. Só HOMOLOGAÇÃO por ora (a tela roda em homologação; agencia_dv já preenchido).
UPDATE public.erp_banco_provider_config
   SET cap_pagamento = true, updated_at = now()
 WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
   AND provider = 'sicredi';
