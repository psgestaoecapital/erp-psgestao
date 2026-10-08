-- Hub de Projetos · telas novas no MENU (CEO 08/10: "as telas estão iguais"). Aditiva: itens de menu, catálogo de telas
-- e features NOVOS; nada existente é alterado. Resultado por obra (#2244) e Cockpit da obra (#2242) passam a ter menu,
-- mesmos planos do item "Acompanhamento", e entram em system_screens (RD-35).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared)
VALUES
  ('projetos_resultado_obra', 'Resultado por obra', 'hub', 'projetos_obras', '💰', '/dashboard/projetos/obras/resultado', 133, true,
   'Receita (serviço + material), custos, margem e previsto × realizado de cada obra, com CSV.', '2_svc', false),
  ('projetos_cockpit_obra', 'Cockpit da obra', 'hub', 'projetos_obras', '🧭', '/dashboard/projetos/obras/cockpit', 134, true,
   'Escolha a obra e veja avanço, custo, margem, prazo e pendências do dia.', '2_svc', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('projetos_resultado_obra'), ('projetos_cockpit_obra')) m(id)
 WHERE pm.module_id = 'projetos_acompanhamento'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos)
SELECT v.id, v.mod, 'operacional', v.titulo, v.descr, 'pronto', 100, 'alta',
       COALESCE((SELECT array_agg(DISTINCT pm.plan_id) FROM public.plan_modules pm WHERE pm.module_id = 'projetos_acompanhamento'), ARRAY[]::text[])
FROM (VALUES
  ('F.projetos_resultado_obra.resultado', 'projetos_resultado_obra', 'Resultado por obra', 'Receita, custo e margem por obra, previsto × realizado.'),
  ('F.projetos_cockpit_obra.cockpit', 'projetos_cockpit_obra', 'Cockpit da obra', 'Avanço, custo, margem, prazo e pendências do dia de cada obra.')
) AS v(id, mod, titulo, descr)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub', v.titulo, v.descr, NULL, true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos.obras.resultado', '/dashboard/projetos/obras/resultado', 'Hub · Resultado por obra', 'Receita, custo, margem e previsto × realizado por obra.'),
  ('dashboard.projetos.obras.cockpit',   '/dashboard/projetos/obras/cockpit',   'Hub · Cockpit da obra',   'Escolha da obra para abrir o cockpit (avanço, custo, margem, prazo, pendências).')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);

INSERT INTO public.screen_route_features (screen_id, feature_id)
SELECT s.id, v.feature FROM (VALUES ('/dashboard/projetos/obras/resultado', 'F.projetos_resultado_obra.resultado'),
                                    ('/dashboard/projetos/obras/cockpit', 'F.projetos_cockpit_obra.cockpit')) v(rota, feature)
  JOIN public.system_screens s ON s.rota = v.rota
ON CONFLICT (screen_id, feature_id) DO NOTHING;
UPDATE public.system_screens SET estado_real = 'pronto', atualizado_em = now()
 WHERE rota IN ('/dashboard/projetos/obras/resultado', '/dashboard/projetos/obras/cockpit') AND estado_real IS NULL;
