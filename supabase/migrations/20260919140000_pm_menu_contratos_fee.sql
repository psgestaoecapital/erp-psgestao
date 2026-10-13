-- #59 PDOIS · atalho "Contratos & Fee" no menu do P&M (grupo pm, seção Comercial & Entrada = pm_comercial).
-- O formulário de fee vive em /dashboard/contratos (área GE, aba "Solicitações & Fee"); o cliente do P&M
-- não achava. Adiciona um MÓDULO COMPARTILHADO (is_shared) cuja casa é a GE mas que aparece no grupo 'pm'
-- via surface_in_groups — o ramo shared da fn_modulos_sidebar_por_area NÃO exige plan_modules, então
-- surge para qualquer empresa que já acessa a área P&M (a PDOIS tem gestao_empresarial_pro). RD-33.
-- Rota ?tab=fee abre direto a aba (a página aceita tab=fee e aba=fee). Idempotente (RD-52).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, surface_in_groups, rbac_isento)
VALUES ('pm_contratos_fee', 'Contratos & Fee', 'gestao_empresarial', 'pm_comercial', '/dashboard/contratos?tab=fee', 'FileText', 40, true, false, true, ARRAY['pm']::text[], false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo, rota = EXCLUDED.rota,
  icone = EXCLUDED.icone, ordem = EXCLUDED.ordem, ativo = EXCLUDED.ativo, legacy = EXCLUDED.legacy,
  is_shared = EXCLUDED.is_shared, surface_in_groups = EXCLUDED.surface_in_groups;
