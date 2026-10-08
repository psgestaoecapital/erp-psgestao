-- Hub: Resultado por obra e Cockpit no MENU (module_catalog) + system_screens (tela sem menu não é tela).
-- Aditivo e idempotente. Os módulos entram nos mesmos planos que já têm projetos_obras.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT v.id, v.nome, o.grupo, v.icone, v.rota, v.ordem, true, v.descricao, o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o
CROSS JOIN (VALUES
  ('projetos_resultado_obra', 'Resultado por obra', '📈', '/dashboard/projetos/obras/resultado', 132, 'Receita, custo e margem por obra, previsto × realizado, com consolidado.'),
  ('projetos_cockpit_obra',   'Cockpit da obra',    '🧭', '/dashboard/projetos/cockpit',          133, 'Avanço, custo, margem e pendências de uma obra numa tela só.')
) AS v(id, nome, icone, rota, ordem, descricao)
WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, v.id
FROM public.plan_modules pm
CROSS JOIN (VALUES ('projetos_resultado_obra'), ('projetos_cockpit_obra')) AS v(id)
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = v.id);

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES
  ('dashboard.projetos_obras_resultado', '/dashboard/projetos/obras/resultado', 'hub_construcao', 'Resultado por obra', 'Receita, custo e margem por obra (v_obra_resultado)', 'parcial', 'alta'),
  ('dashboard.projetos_cockpit', '/dashboard/projetos/cockpit', 'hub_construcao', 'Cockpit (escolher obra)', 'Porta de entrada do cockpit da obra', 'parcial', 'alta'),
  ('dashboard.projetos_obras_id_cockpit', '/dashboard/projetos/obras/[id]/cockpit', 'hub_construcao', 'Cockpit da obra', 'Avanço, custo, margem e pendências da obra', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
