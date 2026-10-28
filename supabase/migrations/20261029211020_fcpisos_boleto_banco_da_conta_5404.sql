-- Chamado #5404 (FC Pisos) · boleto sai pelo banco da conta do título.
-- Correção de dado de UMA empresa: preenche banco_codigo das contas e liga cada configuração à sua conta.
-- Estado anterior (backup): banco_codigo NULL nas 3 contas; banco_conta_id NULL nas 3 configurações. Só toca campos NULL.
UPDATE public.erp_banco_contas SET banco_codigo = '001', updated_at = now()
 WHERE id = '2f5dcb58-d918-4dca-8802-260d296c7aea' AND company_id = 'b202b50f-37cb-462e-accf-126869de49f0' AND banco_codigo IS NULL;
UPDATE public.erp_banco_contas SET banco_codigo = '748', updated_at = now()
 WHERE id = '56dc6672-9639-4774-af41-b9d67cb09d20' AND company_id = 'b202b50f-37cb-462e-accf-126869de49f0' AND banco_codigo IS NULL;
UPDATE public.erp_banco_provider_config SET banco_conta_id = '2f5dcb58-d918-4dca-8802-260d296c7aea'
 WHERE id = '08767738-64a7-438e-856d-c8cac139c964' AND company_id = 'b202b50f-37cb-462e-accf-126869de49f0' AND banco_conta_id IS NULL;
UPDATE public.erp_banco_provider_config SET banco_conta_id = '56dc6672-9639-4774-af41-b9d67cb09d20'
 WHERE id = '12334457-cb71-42d6-b9d9-f34fab8cb1f1' AND company_id = 'b202b50f-37cb-462e-accf-126869de49f0' AND banco_conta_id IS NULL;
