-- Hub › Propostas (RD-98): a proposta-fixture "ORC-DEMO-OBRA-PROVA" (sem cliente, sem itens, R$ 1.000) polui a lista da DEMO.
-- Exclusão LÓGICA (deleted_at + motivo; sem DELETE físico), só em empresa DEMO, só se continuar sem itens e sem vínculo.
UPDATE public.erp_orcamentos o
   SET deleted_at = now(),
       motivo_exclusao = 'Fixture de prova da DEMO (sem cliente e sem itens) — removida da lista (RD-98)'
 WHERE o.numero = 'ORC-DEMO-OBRA-PROVA'
   AND o.deleted_at IS NULL
   AND o.cliente_nome IS NULL
   AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = o.company_id AND c.is_demo)
   AND NOT EXISTS (SELECT 1 FROM public.erp_orcamentos_itens i WHERE i.orcamento_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM public.projetos_obras b WHERE b.orcamento_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM public.erp_crm_oportunidade p WHERE p.orcamento_id = o.id);
