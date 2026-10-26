-- "?" (RD-95) do Cockpit da obra (escolher obra + links da obra). Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.cockpit.escolher_obra', 'Cockpit', 'Cockpit da obra',
 'Escolha a obra que quer acompanhar. Se a empresa tem só uma obra, ela abre direto.',
 'O cockpit reúne avanço, custo, margem e pendências de uma obra numa tela só, para decidir sem abrir vários relatórios.', 'Obra 0012 — Reforma da fábrica', 'Procurar aqui uma obra que ainda não nasceu: aprove o orçamento primeiro.', 100, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.status_obra', 'Cockpit', 'Situação da obra',
 'Nada a preencher: mostra a situação atual da obra (em andamento, concluída, pausada ou cancelada).',
 'Ajuda a achar a obra certa. A situação é mudada na lista de Obras.', 'Em andamento', 'Esperar mudar a situação por aqui: use a lista de Obras.', 110, '/dashboard/projetos/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.lancar_horas', 'Atalhos', 'Lançar horas',
 'Abre a folha de horas desta obra para registrar quem trabalhou e quantas horas.',
 'As horas viram custo de mão de obra e entram na margem da obra.', '8 h do pedreiro Carlos hoje', 'Lançar a hora na obra errada: o custo vai para outra margem.', 120, '/dashboard/projetos/obras/[id]/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.linha_tempo', 'Atalhos', 'Ver linha do tempo',
 'Abre o histórico da obra: medições, compras, horas e mudanças de situação em ordem de data.',
 'Serve para entender como a obra chegou ao custo e à margem de hoje.', 'Medição 2 em 10/10', 'Procurar valores aqui: a linha do tempo mostra fatos, não totais.', 130, '/dashboard/projetos/obras/[id]/cockpit', 'projetos', 'publicado'),
('projetos.cockpit.cronograma', 'Atalhos', 'Ver cronograma',
 'Abre as etapas da obra com datas previstas e realizadas.',
 'Compara o prazo planejado com o andamento real e mostra atrasos.', 'Fundação: 01/10 a 15/10', 'Achar que o avanço financeiro do cockpit é o avanço físico do cronograma.', 140, '/dashboard/projetos/obras/[id]/cockpit', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
