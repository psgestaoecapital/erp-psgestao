-- Hub: telas novas (Resultado por obra #2244, Cockpit da obra #2242) entram no MENU e no catálogo de telas.
-- Aditiva e idempotente: 2 linhas em module_catalog (mesmo subgrupo de Obras) + 2 em system_screens. Sem dado de cliente.
INSERT INTO public.module_catalog (id, nome, rota, ativo, grupo, icone, ordem, so_ps, legacy, subgrupo, descricao, is_shared, vertical_specific)
VALUES
  ('projetos_resultado_obra', 'Resultado por obra', '/dashboard/projetos/obras/resultado', true, 'hub', '📈', 133, false, false, 'projetos_obras',
   'Receita, custo direto, rateio e margem por obra: previsto x realizado.', false, ARRAY['hub']),
  ('projetos_cockpit_obra', 'Cockpit da obra', '/dashboard/projetos/obras/cockpit', true, 'hub', '🎛️', 134, false, false, 'projetos_obras',
   'Avanço, custo, margem, prazo e pendências do dia da obra escolhida.', false, ARRAY['hub'])
ON CONFLICT (id) DO NOTHING;

-- toda empresa que já tem o item Obras no plano passa a ver os novos
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, n.id
FROM public.plan_modules pm
CROSS JOIN (VALUES ('projetos_resultado_obra'), ('projetos_cockpit_obra')) n(id)
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = n.id);

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub_construcao', v.titulo, v.descr, NULL, true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos.obras_resultado', '/dashboard/projetos/obras/resultado', 'Resultado por obra', 'Receita, custo direto e margem por obra, previsto x realizado.'),
  ('dashboard.projetos.obras_cockpit',   '/dashboard/projetos/obras/cockpit',   'Cockpit da obra',   'Escolhe a obra e abre o cockpit: avanço, custo, margem, prazo e pendências.')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
