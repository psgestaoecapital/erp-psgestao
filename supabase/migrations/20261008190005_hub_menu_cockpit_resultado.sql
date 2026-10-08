-- Hub: "Cockpit da obra" e "Resultado por obra" no menu (CEO 08/10: "não tem tela nova"). Aditiva: só linhas novas.
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared)
VALUES
  ('projetos_obra_cockpit', 'Cockpit da obra', 'hub', 'projetos_obras', 'Gauge', '/dashboard/projetos/obras/cockpit', 132, true,
   'Avanço, custo, margem, prazo e pendências do dia da obra escolhida.', '2_svc', false),
  ('projetos_obra_resultado', 'Resultado por obra', 'hub', 'projetos_obras', 'Scale', '/dashboard/projetos/obras/resultado', 133, true,
   'Receita, custo direto, rateio e margem por obra e consolidado.', '2_svc', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('projetos_obra_cockpit'), ('projetos_obra_resultado')) m(id)
 WHERE pm.module_id = 'projetos_acompanhamento'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub', v.titulo, v.descr, NULL, true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos.obras.cockpit',   '/dashboard/projetos/obras/cockpit',   'Hub · Cockpit da obra',   'Escolha da obra e cockpit com avanço, custo, margem, prazo e pendências.'),
  ('dashboard.projetos.obras.resultado', '/dashboard/projetos/obras/resultado', 'Hub · Resultado por obra', 'Receita, custo e margem por obra e consolidado.')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
