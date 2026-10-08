-- Hub: telas novas (Resultado por obra, Cockpit da obra) entram no menu e em system_screens (CEO 08/10).
-- Aditiva e idempotente. O cockpit é por obra (/obras/[id]/cockpit): o item de menu abre a lista de Obras,
-- onde cada linha tem o botão "Abrir cockpit".
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, ordem, ativo, icone, descricao)
VALUES
 ('projetos_obra_resultado', 'Resultado por obra', 'hub', 'projetos_obras', '/dashboard/projetos/obras/resultado', 132, true, '📈',
  'Receita, custo, previsto × realizado e margem por obra e consolidado.'),
 ('projetos_obra_cockpit', 'Cockpit da obra', 'hub', 'projetos_obras', '/dashboard/projetos/obras?abrir=cockpit', 133, true, '🧭',
  'Avanço, custo, margem, prazo e pendências do dia — escolha a obra e abra o cockpit.')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, subgrupo = EXCLUDED.subgrupo, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem,
  ativo = EXCLUDED.ativo, icone = EXCLUDED.icone, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, modulo)
VALUES
 ('dashboard.projetos_obras_resultado', '/dashboard/projetos/obras/resultado', 'hub_construcao', 'Resultado por obra',
  'Resultado por obra e consolidado (v_obra_resultado), somente leitura, com exportação.', 'parcial', 'projetos_obra_resultado'),
 ('dashboard.projetos_obras_cockpit', '/dashboard/projetos/obras/[id]/cockpit', 'hub_construcao', 'Cockpit da obra',
  'Avanço, custo, margem, prazo e pendências do dia de uma obra.', 'parcial', 'projetos_obra_cockpit')
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota, titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional, modulo = EXCLUDED.modulo;
