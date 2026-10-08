-- Hub: Resultado por obra e Cockpit da obra no menu (CEO 08/10: "as telas estão iguais"). Aditiva e idempotente.
-- Os dois módulos espelham os planos de projetos_obras (mesmo acesso de quem já vê Obras); nada é removido.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, subgrupo, surface_in_groups)
SELECT v.id, v.nome, 'hub', v.icone, v.rota, v.ordem, true, v.descr, false, 'projetos_obras', ARRAY['hub']
FROM (VALUES
  ('projetos_resultado_obra', 'Resultado por obra', '⚖️', '/dashboard/projetos/obras/resultado', 132,
   'Receita, custo direto, rateio e margem de cada obra — previsto × realizado.'),
  ('projetos_cockpit_obra', 'Cockpit da obra', '🧭', '/dashboard/projetos/obras/cockpit', 133,
   'Avanço, custo, margem, prazo e pendências do dia da obra escolhida.')
) AS v(id, nome, icone, rota, ordem, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.module_catalog m WHERE m.id = v.id);

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT pm.plan_id, m.id, pm.is_default_active, pm.minimum_sla, pm.legacy
FROM public.plan_modules pm
CROSS JOIN (VALUES ('projetos_resultado_obra'), ('projetos_cockpit_obra')) m(id)
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub_construcao', v.titulo, v.descr, NULL, true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos.obras.resultado', '/dashboard/projetos/obras/resultado', 'Resultado por obra', 'Receita, custo, rateio e margem por obra, previsto × realizado.'),
  ('dashboard.projetos.obras.cockpit', '/dashboard/projetos/obras/cockpit', 'Cockpit da obra (escolher obra)', 'Lista as obras e abre o cockpit da escolhida.'),
  ('dashboard.projetos.obras.id.cockpit', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Avanço, custo, margem, prazo e pendências do dia de uma obra.')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
