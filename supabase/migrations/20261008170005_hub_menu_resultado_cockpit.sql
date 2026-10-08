-- Hub · telas novas no MENU e nas abas (CEO 08/10: "as telas estão iguais"). RD-35: tela + menu + feature juntas.
-- Aditiva: só objetos novos (module_catalog, system_screens, feature_catalog, plan_modules, screen_route_features).
-- Resultado por obra = /dashboard/projetos/obras/resultado (#2244); Cockpit = /dashboard/projetos/cockpit (lista as obras e abre o cockpit [id], #2242).

INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared, surface_in_groups)
VALUES
  ('projetos_resultado_obra', 'Resultado por obra', 'hub', 'projetos_obras', '📈', '/dashboard/projetos/obras/resultado', 132, true,
   'Receita (serviço medido + material vendido) menos custo (material e viagens), previsto × realizado, por obra e consolidado.',
   '2_svc', false, ARRAY['hub']::text[]),
  ('projetos_cockpit_obra', 'Cockpit da obra', 'hub', 'projetos_obras', '🧭', '/dashboard/projetos/cockpit', 133, true,
   'Escolha a obra e abra o cockpit: avanço, custo, margem, prazo e pendências do dia.',
   '2_svc', false, ARRAY['hub']::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('projetos_resultado_obra'), ('projetos_cockpit_obra')) m(id)
 WHERE pm.module_id = 'projetos_obras'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos)
VALUES
  ('F.hub.projetos_resultado_obra', 'projetos_resultado_obra', 'operacional', 'Resultado por obra',
   'Receita, custo, margem e previsto × realizado por obra e consolidado, com exportação.', 'pronto', 100, 'alta',
   ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4']),
  ('F.hub.projetos_cockpit_obra', 'projetos_cockpit_obra', 'operacional', 'Cockpit da obra',
   'Avanço, custo, margem, prazo e pendências do dia de cada obra, a partir da lista de obras.', 'pronto', 100, 'alta',
   ARRAY['v15_hub_t1','v15_hub_t2','v15_hub_t3','v15_hub_t4'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, auditavel_robo)
VALUES
  ('dashboard.projetos_resultado_obra', '/dashboard/projetos/obras/resultado', 'hub_construcao', 'Hub · Resultado por obra',
   'Receita, custo e margem por obra (v_obra_resultado), previsto × realizado, consolidado e Excel.', 'projetos_resultado_obra', 'pronto', 'media', true),
  ('dashboard.projetos_cockpit_obra', '/dashboard/projetos/cockpit', 'hub_construcao', 'Hub · Cockpit da obra',
   'Lista as obras da empresa e abre o cockpit da obra escolhida.', 'projetos_cockpit_obra', 'pronto', 'media', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
VALUES ('dashboard.projetos_resultado_obra', 'F.hub.projetos_resultado_obra', 1, 'primary'),
       ('dashboard.projetos_cockpit_obra', 'F.hub.projetos_cockpit_obra', 1, 'primary')
ON CONFLICT DO NOTHING;
