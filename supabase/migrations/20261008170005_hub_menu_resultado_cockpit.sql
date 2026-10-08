-- Hub: telas novas (Resultado por obra #2244, Cockpit da obra #2242) entram no MENU e em system_screens.
-- Aditiva: só INSERT idempotente; nada existente é alterado.
INSERT INTO public.module_catalog (id, nome, rota, grupo, subgrupo, ordem, ativo, is_shared, vertical_specific, icone, layer, descricao)
VALUES
 ('hub_resultado_obra','Resultado por obra','/dashboard/projetos/obras/resultado','hub','projetos_obras',133,true,false,NULL,'📊','2_svc',
  'Receita, custo direto, rateio e margem por obra (previsto × realizado).'),
 ('hub_cockpit_obra','Cockpit da obra','/dashboard/projetos/obras?destino=cockpit','hub','projetos_obras',134,true,false,NULL,'🧭','2_svc',
  'Avanço, custo, margem, prazo e pendências do dia da obra escolhida.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, prioridade_monitoramento, auditavel_robo)
VALUES
 ('dashboard.projetos_obras_resultado','/dashboard/projetos/obras/resultado','hub_construcao','Resultado por Obra',
  'Receita, custo e margem por obra, previsto × realizado.','alta',true),
 ('dashboard.projetos_obras_cockpit','/dashboard/projetos/obras/[id]/cockpit','hub_construcao','Cockpit da Obra',
  'Avanço, custo, margem, prazo e pendências do dia.','alta',true)
ON CONFLICT (id) DO NOTHING;
