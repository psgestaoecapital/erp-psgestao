-- #120: tela "Notificações no celular" no MENU (module_catalog), plan_modules e system_screens. Aditivo e idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'admin_notificacoes_celular', 'Notificações no celular', o.grupo, '🔔', '/dashboard/configuracoes/notificacoes-celular', o.ordem + 1, true,
       'Receba no celular, com o app fechado, os avisos do sistema (ex.: oportunidade mudou de etapa).', o.layer, true, '{}', false, o.subgrupo, o.surface_in_groups, false, true, false
FROM public.module_catalog o WHERE o.id = 'admin_dados_empresa'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'admin_notificacoes_celular' FROM public.plan_modules pm
WHERE pm.module_id = 'admin_dados_empresa'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'admin_notificacoes_celular');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.configuracoes_notificacoes_celular', '/dashboard/configuracoes/notificacoes-celular', 'administracao', 'Notificações no celular', 'Liga/desliga o aviso no celular (Web Push) neste aparelho; orienta o iPhone a adicionar à tela de início', 'parcial', 'media')
ON CONFLICT (id) DO NOTHING;
