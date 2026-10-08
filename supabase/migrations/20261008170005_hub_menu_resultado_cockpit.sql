-- Hub · menu: "Resultado por obra" e "Cockpit da obra" entram no menu do banco (mesmo mecanismo do check_menu),
-- nos mesmos planos de "Acompanhamento", e as rotas entram em system_screens. Só objetos novos (aditivo).
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared, surface_in_groups)
VALUES
  ('projetos_resultado', 'Resultado por obra', 'hub', 'projetos_obras', '📈', '/dashboard/projetos/obras/resultado', 132, true,
   'Receita, custo, rateio e margem por obra, previsto × realizado.', '2_svc', NULL, false, ARRAY['hub']),
  ('projetos_cockpit', 'Cockpit da obra', 'hub', 'projetos_obras', '🧭', '/dashboard/projetos/obras/cockpit', 133, true,
   'Escolha a obra e abra o cockpit: avanço, custo, margem, prazo e pendências do dia.', '2_svc', NULL, false, ARRAY['hub'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('projetos_resultado'), ('projetos_cockpit')) m(id)
 WHERE pm.module_id = 'projetos_acompanhamento'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub_construcao', v.titulo, v.descr, 'pronto', true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos_obras_resultado', '/dashboard/projetos/obras/resultado', 'Hub · Resultado por obra', 'Receita, custo direto, rateio e margem por obra e consolidado.'),
  ('dashboard.projetos_obras_cockpit', '/dashboard/projetos/obras/cockpit', 'Hub · Cockpit da obra (escolher obra)', 'Lista as obras da empresa e abre o cockpit da obra escolhida.'),
  ('dashboard.projetos_obras_id_cockpit', '/dashboard/projetos/obras/[id]/cockpit', 'Hub · Cockpit da obra', 'Avanço, custo, margem, prazo e pendências do dia de uma obra.')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
