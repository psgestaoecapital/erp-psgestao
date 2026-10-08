-- HUB: Resultado por obra e Cockpit da obra entram no MENU (CEO 08/10: "as telas estão iguais, não tem tela nova").
-- Aditivo: 2 itens novos em module_catalog (mesmos planos do item "Obras"), 2 telas em system_screens. Nada removido.
INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, ordem, ativo, is_shared, icone, layer, descricao)
VALUES
  ('projetos_obras_resultado','Resultado por obra','/dashboard/projetos/obras/resultado','hub','projetos_obras',133,true,false,'📊','2_svc',
   'Receita, custo direto, rateio e margem de cada obra, previsto × realizado, com consolidado e exportação para Excel.'),
  ('projetos_obras_cockpit','Cockpit da obra','/dashboard/projetos/obras?destino=cockpit','hub','projetos_obras',134,true,false,'🧭','2_svc',
   'Avanço, custo, margem, prazo e pendências do dia da obra escolhida: escolha a obra e abra o cockpit.')
ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, subgrupo=EXCLUDED.subgrupo,
  ordem=EXCLUDED.ordem, ativo=true, descricao=EXCLUDED.descricao;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('projetos_obras_resultado'),('projetos_obras_cockpit')) m(id)
 WHERE pm.module_id = 'projetos_obras'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'hub_construcao', v.titulo, v.descr, 'pronto', true, now(), now(), now()
FROM (VALUES
  ('dashboard.projetos_obras_resultado','/dashboard/projetos/obras/resultado','Hub · Resultado por obra','Receita, custo, rateio e margem por obra (previsto × realizado), consolidado e Excel.'),
  ('dashboard.projetos_obras_cockpit','/dashboard/projetos/obras/[id]/cockpit','Hub · Cockpit da obra','Avanço, custo, margem, prazo e pendências do dia da obra.')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
