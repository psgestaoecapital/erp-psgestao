-- Conserto-main: a migration 20261113170030 (#4702, Caixa do dia do grupo) copiou o menu/plano de
-- id='fluxo_caixa', que NÃO existe no module_catalog — o id real da GE é 'financeiro_fluxo_caixa_ge'.
-- Resultado: a tela entrou (função, system_screens, ajuda OK) mas NÃO apareceu no menu (module_catalog)
-- nem foi ligada aos planos (plan_modules). Aqui copiamos da fonte certa. Aditivo e idempotente.

INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific,
  is_shared, dependencies, subgrupo, surface_in_groups, legacy, diferencial, prioridade, ramos_aplicaveis,
  rbac_isento, rbac_isento_motivo, so_ps)
SELECT 'caixa_grupo', 'Caixa do dia do grupo', grupo, icone, '/dashboard/financeiro/caixa-grupo',
  COALESCE(ordem, 55) + 1, ativo,
  'Caixa do dia de todas as empresas do grupo, por empresa e consolidado: saldo inicial, entradas e saídas do dia por conta, e o que vence hoje/atrasado/7 dias. Só leitura.',
  layer, vertical_specific, is_shared, dependencies, subgrupo, surface_in_groups, legacy, diferencial, prioridade,
  ramos_aplicaveis, rbac_isento, rbac_isento_motivo, so_ps
FROM public.module_catalog WHERE id = 'financeiro_fluxo_caixa_ge'
ON CONFLICT (id) DO NOTHING;

-- Liga o módulo a todo plano que já tem o fluxo de caixa da GE
INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT gen_random_uuid(), pm.plan_id, 'caixa_grupo', pm.is_default_active, pm.minimum_sla, pm.legacy
FROM public.plan_modules pm
WHERE pm.module_id = 'financeiro_fluxo_caixa_ge'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'caixa_grupo');
