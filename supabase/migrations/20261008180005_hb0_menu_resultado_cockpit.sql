-- HB0 · menu do Hub: "Resultado por obra" e "Cockpit da obra" (telas já publicadas nas #2242/#2244, estavam sem menu).
-- Aditiva: 2 linhas de menu nos mesmos planos de "Obras", cadastro em system_screens ligado à funcionalidade.
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared)
VALUES
  ('projetos_resultado_obra', 'Resultado por obra', 'hub', 'projetos_obras', 'Scale', '/dashboard/projetos/obras/resultado', 132, true,
   'Receita, custo direto, rateio e margem por obra, previsto × realizado, por obra e consolidado.', '2_svc', false),
  ('projetos_cockpit_obra', 'Cockpit da obra', 'hub', 'projetos_obras', 'Gauge', '/dashboard/projetos/obras/cockpit', 133, true,
   'Avanço, custo, margem, prazo e pendências do dia de uma obra, numa tela só.', '2_svc', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('projetos_resultado_obra'), ('projetos_cockpit_obra')) m(id)
 WHERE pm.module_id = 'projetos_obras'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos)
VALUES
  ('F.projetos_resultado_obra.resultado', 'projetos_resultado_obra', 'operacional', 'Resultado por obra',
   'Receita, custo, rateio e margem por obra, previsto × realizado.', 'pronto', 100, 'alta', ARRAY[]::text[]),
  ('F.projetos_cockpit_obra.cockpit', 'projetos_cockpit_obra', 'operacional', 'Cockpit da obra',
   'Avanço, custo, margem, prazo e pendências do dia.', 'pronto', 100, 'alta', ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub', v.titulo, v.descr, NULL, true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos.obras.resultado', '/dashboard/projetos/obras/resultado', 'Hub · Resultado por obra', 'Receita, custo, rateio e margem por obra, previsto × realizado.'),
  ('dashboard.projetos.obras.cockpit',   '/dashboard/projetos/obras/cockpit',   'Hub · Cockpit da obra',   'Entrada do cockpit: escolhe a obra e abre avanço, custo, margem, prazo e pendências.')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
INSERT INTO public.screen_route_features (screen_id, feature_id)
SELECT s.id, v.feature FROM (VALUES ('/dashboard/projetos/obras/resultado', 'F.projetos_resultado_obra.resultado'),
                                    ('/dashboard/projetos/obras/cockpit', 'F.projetos_cockpit_obra.cockpit')) v(rota, feature)
  JOIN public.system_screens s ON s.rota = v.rota
ON CONFLICT (screen_id, feature_id) DO NOTHING;
UPDATE public.system_screens SET estado_real = 'pronto', atualizado_em = now()
 WHERE rota IN ('/dashboard/projetos/obras/resultado', '/dashboard/projetos/obras/cockpit') AND estado_real IS NULL;
