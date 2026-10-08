-- Hub: telas novas (Resultado por obra, Cockpit da obra) no menu do banco e em system_screens.
-- Aditiva: só linhas novas. Os mesmos planos da tela "Obras".
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, is_shared)
VALUES
  ('projetos_resultado_obra', 'Resultado por obra', 'hub', 'projetos_obras', '📈', '/dashboard/projetos/obras/resultado', 132, true,
   'Receita, custo direto, rateio e margem de cada obra, previsto × realizado.', '2_svc', false),
  ('projetos_cockpit_obra', 'Cockpit da obra', 'hub', 'projetos_obras', '🧭', '/dashboard/projetos/obras/cockpit', 133, true,
   'Avanço, custo, margem, prazo e pendências do dia da obra escolhida.', '2_svc', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('projetos_resultado_obra'), ('projetos_cockpit_obra')) m(id)
 WHERE pm.module_id = 'projetos_obras'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub_construcao', v.titulo, v.descr, 'pronto', true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos_obras_resultado', '/dashboard/projetos/obras/resultado', 'Hub · Resultado por obra', 'Receita, custo, rateio e margem por obra e consolidado.'),
  ('dashboard.projetos_obras_cockpit',   '/dashboard/projetos/obras/cockpit',   'Hub · Cockpit da obra',   'Escolhe a obra e abre o cockpit (avanço, custo, margem, prazo).')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
