-- "?" (RD-95) da lista de Obras do Hub: indicadores do topo, atalhos, abas, ações do cartão e o quadro "Resultado da obra".
-- Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.obras.kpi_em_andamento', 'Indicadores', 'Obras em andamento',
 'Nada a preencher: conta as obras que estão em execução agora.',
 'Mostra quantas frentes de trabalho a empresa toca ao mesmo tempo. A obra entra aqui ao nascer da proposta aprovada e sai quando é concluída, pausada ou cancelada.', '4 obras em andamento', 'Esquecer de concluir a obra entregue: ela continua contando aqui.', 100, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.kpi_concluidas', 'Indicadores', 'Obras concluídas',
 'Nada a preencher: conta as obras marcadas como concluídas.',
 'Histórico de entregas da empresa. Uma obra reaberta volta para "em andamento" e sai desta conta.', '12 obras concluídas', 'Concluir a obra antes de terminar as medições; reabra se ainda houver serviço.', 110, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.kpi_valor_andamento', 'Indicadores', 'Valor em andamento',
 'Nada a preencher: soma o valor previsto das obras em andamento.',
 'É a carteira em execução (o que ainda vai ser medido e faturado). Vem do valor previsto de cada obra, que nasce do orçamento aprovado.', 'R$ 480.000,00', 'Ler como faturamento: é valor contratado, não recebido.', 120, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.kpi_valor_concluido', 'Indicadores', 'Valor concluído',
 'Nada a preencher: soma o valor previsto das obras concluídas.',
 'Mostra o volume já entregue. Para ver o que foi faturado e recebido de cada obra, use "Ver resultado por obra".', 'R$ 1.250.000,00', 'Comparar com o caixa: obra concluída pode ter parcela a receber.', 130, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.nova_obra', 'Atalhos', 'Nova obra',
 'Abre o assistente para cadastrar uma obra sem passar pela proposta (ex.: obra antiga ou contrato fechado fora do sistema).',
 'Normalmente a obra nasce sozinha quando a proposta é aprovada. Use este atalho só quando não houver proposta.', 'Obra de manutenção contratada por telefone', 'Criar a obra à mão e depois aprovar a proposta da mesma obra, gerando duas.', 140, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.link_resultado', 'Atalhos', 'Ver resultado por obra',
 'Abre a tela com receita, custo e margem de cada obra, previsto × realizado.',
 'É onde se vê se a obra deu lucro. Pode exportar em CSV e PDF.', 'Obra 0012: margem de 18%', 'Olhar só o valor previsto aqui na lista e achar que é o resultado.', 150, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.abas', 'Filtro', 'Abas da lista',
 'Escolha o que ver: obras em andamento e concluídas, ou as pausadas e canceladas.',
 'Separa o que está ativo do que parou, para a lista principal mostrar só o que importa no dia a dia. A segunda aba só aparece quando existe obra pausada ou cancelada.', 'Pausadas · Canceladas (2)', 'Procurar uma obra pausada na primeira aba.', 160, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.acoes_card', 'Ações da obra', 'Ações da obra',
 'Ver escopo: itens contratados. Cockpit: avanço, custo e pendências. Linha do tempo: tudo o que aconteceu. Dados fiscais: CNO para a NFS-e. Concluir, Pausar, Cancelar, Retomar ou Reabrir mudam a situação da obra.',
 'A situação define em que coluna a obra aparece e o que entra nos indicadores. Concluir registra a data de conclusão.', 'Concluir a obra 0012 depois da última medição', 'Cancelar quando a obra só parou por um tempo: use Pausar e depois Retomar.', 170, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.resultado_card', 'Ações da obra', 'Resultado da obra',
 'Nada a preencher: mostra o que já foi faturado (NFS-e autorizadas ligadas à obra), o que foi recebido e o que falta receber.',
 'Acompanha o dinheiro da obra sem sair da lista. Nota sem título no financeiro não entra no recebido.', 'Faturado R$ 60.000 · Recebido R$ 40.000 · A receber R$ 20.000', 'Emitir a nota sem ligar à obra: ela não aparece aqui.', 180, '/dashboard/projetos/obras', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
