-- Pendência Jordana #4: capturar a chave PIX no título e levá-la pro item da remessa de pagamento.
alter table public.erp_pagar   add column if not exists tipo_chave_pix text, add column if not exists chave_pix text;
alter table public.erp_receber add column if not exists tipo_chave_pix text, add column if not exists chave_pix text;
alter table public.erp_remessa_pagamento_item add column if not exists tipo_chave_pix text, add column if not exists chave_pix text;
comment on column public.erp_pagar.tipo_chave_pix is 'cpf_cnpj | telefone | email | aleatoria | copia_cola';
comment on column public.erp_receber.tipo_chave_pix is 'cpf_cnpj | telefone | email | aleatoria | copia_cola';
