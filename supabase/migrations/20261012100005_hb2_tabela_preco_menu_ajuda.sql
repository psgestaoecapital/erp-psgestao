-- HB2 (fatia 2): tela "Tabela de preço por cliente" no MENU (module_catalog), system_screens e "?" (RD-95). Aditivo e idempotente.
INSERT INTO public.module_catalog (id, nome, grupo, icone, rota, ordem, ativo, descricao, layer, is_shared, dependencies, legacy, subgrupo, surface_in_groups, diferencial, rbac_isento, so_ps)
SELECT 'projetos_tabela_preco', 'Tabela de preço', o.grupo, '🏷️', '/dashboard/projetos/tabelas-preco', 134, true,
       'Preço por cliente com faixas de quantidade e adicionais por turno.', o.layer, false, '{}', false, o.subgrupo, o.surface_in_groups, false, false, false
FROM public.module_catalog o WHERE o.id = 'projetos_obras'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'projetos_tabela_preco' FROM public.plan_modules pm
WHERE pm.module_id = 'projetos_obras'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'projetos_tabela_preco');

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_tabelas_preco', '/dashboard/projetos/tabelas-preco', 'hub_construcao', 'Tabela de preço por cliente', 'Faixa de quantidade e adicional por turno, com margem contra a CPU', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.tela', 'Tabela de preço por cliente', 'Nada a preencher: escolha a tabela, o serviço, a quantidade e o turno.', 'Mostra o preço que vale para aquele cliente, já na faixa certa e com o adicional do turno.', '350 m² de Pintura Epóxi no sábado: faixa 100–500 com +50%.', 'Usar o preço de tabela normal quando o serviço é feito no fim de semana.', 1),
 ('hub.tabela_preco.tabela', 'Tabela do cliente', 'Escolha a tabela combinada com o cliente.', 'Cada cliente pode ter faixas e adicionais próprios.', 'Tabela BRF 2026.', 'Escolher a tabela de outro cliente.', 2),
 ('hub.tabela_preco.servico', 'Serviço', 'Escolha o serviço do catálogo que será vendido.', 'Define as faixas de preço consideradas.', 'Pintura Epóxi (m²).', 'Confundir serviços parecidos; confira a unidade ao lado do nome.', 3),
 ('hub.tabela_preco.quantidade', 'Quantidade', 'Digite a quantidade na unidade do serviço.', 'A quantidade escolhe a faixa: quanto maior, em geral menor o preço por unidade.', '350', 'Digitar a metragem em outra unidade (km no lugar de m).', 4),
 ('hub.tabela_preco.condicao', 'Condição (turno / dia)', 'Normal, noturno, sábado, domingo/feriado — conforme a tabela.', 'Aplica o adicional combinado (percentual) ou o preço fixo da condição, e mostra o código do item no cliente.', 'Sábado: +50%.', 'Deixar em Normal para serviço de fim de semana.', 5),
 ('hub.tabela_preco.custo', 'Custo da CPU por unidade', 'Opcional: informe o custo por unidade da composição de custo do serviço.', 'Permite ver a margem do preço calculado.', '14,50', 'Informar o custo do total, e não por unidade.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
