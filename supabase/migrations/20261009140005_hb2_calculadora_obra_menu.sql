-- HB2 · Calculadora de Obra: item de menu do banco (module_catalog) + planos. Aditivo e idempotente; a tela só conta como entregue se aparece no menu.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'projetos_calculadora_obra', 'Calculadora de obra', o.grupo, '🧮', '/dashboard/projetos/calculadora', 134, true,
       'Lista de materiais por sistema (parede, forro) com a conta de cada item.', o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_calculadora_obra'
FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_calculadora_obra');
