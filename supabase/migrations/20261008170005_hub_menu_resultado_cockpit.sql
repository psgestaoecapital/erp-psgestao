-- Hub · Resultado por obra e Cockpit da obra no MENU (CEO 08/10: "as telas estão iguais, não tem tela nova").
-- As telas (#2242 cockpit, #2244 resultado) existiam escondidas: sem item de menu e sem system_screens.
-- Aditiva: só INSERT em catálogos (module_catalog, plan_modules, feature_catalog, system_screens, screen_route_features).

-- 1) menu: dois itens novos no subgrupo Obras, nos mesmos planos de "Obras"
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES
  ('projetos_obras_resultado', 'Resultado por obra', 'hub', 'projetos_obras', '💹', '/dashboard/projetos/obras/resultado', 132, true,
   'Receita (serviço + material), custo (material, viagens), previsto × realizado e margem, por obra e consolidado.',
   '2_svc', NULL, false),
  ('projetos_obras_cockpit', 'Cockpit da obra', 'hub', 'projetos_obras', '🧭', '/dashboard/projetos/obras/cockpit', 133, true,
   'Avanço, custo, margem, prazo e pendências do dia de uma obra, a um toque da lista de obras.',
   '2_svc', NULL, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id
  FROM public.plan_modules pm
 CROSS JOIN (VALUES ('projetos_obras_resultado'), ('projetos_obras_cockpit')) m(id)
 WHERE pm.module_id = 'projetos_obras'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

-- 2) funcionalidades (RD-35: a tela nasce ligada à sua funcionalidade)
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos)
VALUES
  ('F.projetos_obras.resultado_por_obra', 'projetos_obras_resultado', 'operacional', 'Resultado por obra',
   'Receita, custo, previsto × realizado e margem por obra e consolidado (pedido do Diego, FC Pisos).', 'pronto', 100, 'alta',
   COALESCE((SELECT array_agg(DISTINCT plan_id::text) FROM public.plan_modules WHERE module_id = 'projetos_obras'), ARRAY[]::text[])),
  ('F.projetos_obras.cockpit_obra', 'projetos_obras_cockpit', 'operacional', 'Cockpit da obra',
   'Visão única da obra: avanço, custo, margem, prazo e pendências.', 'pronto', 100, 'alta',
   COALESCE((SELECT array_agg(DISTINCT plan_id::text) FROM public.plan_modules WHERE module_id = 'projetos_obras'), ARRAY[]::text[]))
ON CONFLICT (id) DO NOTHING;

-- 3) catálogo de telas
INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, rpcs_chamadas, auditavel_robo)
VALUES
  ('dashboard.projetos_obras_resultado', '/dashboard/projetos/obras/resultado', 'hub_construcao', 'Resultado por obra',
   'Receita, custo, previsto × realizado e margem por obra, com linha consolidada e exportação.', 'projetos_obras_resultado',
   'pronto', 'alta', ARRAY[]::text[], true),
  ('dashboard.projetos_obras_cockpit', '/dashboard/projetos/obras/cockpit', 'hub_construcao', 'Cockpit da obra (escolha)',
   'Lista as obras e abre o cockpit da escolhida (uma só obra abre direto).', 'projetos_obras_cockpit',
   'pronto', 'alta', ARRAY['fn_obras_listar']::text[], true)
ON CONFLICT (id) DO UPDATE SET
  rota=EXCLUDED.rota, area=EXCLUDED.area, titulo=EXCLUDED.titulo, descricao_funcional=EXCLUDED.descricao_funcional,
  modulo=EXCLUDED.modulo, estado_real=EXCLUDED.estado_real, atualizado_em=now();

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
VALUES ('dashboard.projetos_obras_resultado', 'F.projetos_obras.resultado_por_obra', 1, 'primary'),
       ('dashboard.projetos_obras_cockpit',   'F.projetos_obras.cockpit_obra',       1, 'primary')
ON CONFLICT DO NOTHING;
