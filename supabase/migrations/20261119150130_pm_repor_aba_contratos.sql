-- CEO 17/11: repor a aba "Contratos & Fee" no grupo "1 · Comercial & Entrada" do P&M (pm_comercial,
-- surface_in_groups=['pm'], rota /dashboard/contratos?tab=fee). Foi desativada por engano na última melhoria
-- do menu P&M. RD-26: a tela já existe — só reativar. Aditivo/reversível; não altera dado de cliente.
UPDATE public.module_catalog SET ativo = true WHERE id = 'pm_contratos_fee';
-- Reversível: UPDATE public.module_catalog SET ativo = false WHERE id = 'pm_contratos_fee';
