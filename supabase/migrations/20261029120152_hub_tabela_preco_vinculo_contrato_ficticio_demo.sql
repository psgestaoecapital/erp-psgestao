-- Hub · Tabela de preço (DEMO): liga os 3 serviços do contrato-modelo "Piso industrial (fictício)" da Construtora DEMO
-- ao catálogo, fechando a divida recorrente do auditor ("Sem vínculo"). São os MESMOS serviços reais (epóxi, uretano,
-- preparo de base), só com nome mais curto no contrato-modelo; o catálogo tem o item equivalente com CPU.
-- Os contratos reais do DEMO (Frigorífico Oeste e Residencial Vista Verde) já estão ligados; a "Mobilização" (verba)
-- fica honestamente sem vínculo (não é serviço de catálogo com CPU).
-- Aditiva: só dados DEMO (vínculo), idempotente. Sem dado de cliente; sem mudança de schema/função/RLS.
INSERT INTO public.erp_tabela_preco_vinculo (company_id, tabela_id, servico_ref, catalogo_servico_id, atualizado_em)
SELECT v.company_id::uuid, v.tabela_id::uuid, v.servico_ref, v.catalogo_servico_id::uuid, now()
FROM (VALUES
  ('b0700000-0000-4000-a000-000000000006','728e5b99-93c3-4869-9bc7-6ce758ca6b48','epoxi-autonivel','749903ef-4c76-44c4-9631-a21fb9c942f3'),
  ('b0700000-0000-4000-a000-000000000006','728e5b99-93c3-4869-9bc7-6ce758ca6b48','piso-uretano-6','c32d4be4-e67b-4d91-870f-7d20a08e0813'),
  ('b0700000-0000-4000-a000-000000000006','728e5b99-93c3-4869-9bc7-6ce758ca6b48','preparo-base','1c360967-eeb5-41f2-bf1b-8bef8f3cabc6')
) AS v(company_id, tabela_id, servico_ref, catalogo_servico_id)
-- só se o contrato-modelo, o serviço da faixa e o item de catálogo existirem (não cria vínculo órfão)
WHERE EXISTS (SELECT 1 FROM public.erp_tabela_preco_cliente t WHERE t.id = v.tabela_id::uuid AND t.company_id = v.company_id::uuid)
  AND EXISTS (SELECT 1 FROM public.erp_tabela_preco_item i WHERE i.tabela_id = v.tabela_id::uuid AND i.servico_ref = v.servico_ref AND i.deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM public.projetos_servicos ps WHERE ps.id = v.catalogo_servico_id::uuid)
ON CONFLICT (tabela_id, servico_ref) DO UPDATE SET catalogo_servico_id = EXCLUDED.catalogo_servico_id, atualizado_em = now();
