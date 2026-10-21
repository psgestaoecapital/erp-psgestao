-- HB3 (fatia 2): tela do cronograma da obra — ajuda de campo ("?", RD-95), tela em system_screens e atalho no menu. Aditivo e idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.cronograma.nome', '/dashboard/projetos/obras/[id]/cronograma', 'Cronograma', 'Nome da tarefa',
   'O nome da etapa como a equipe a chama no canteiro.', 'Aparece na lista, na barra do cronograma e na escolha de “Começa depois de”.',
   'Contrapiso — galpão 2', 'Nomes genéricos como “Etapa 1”: ninguém sabe do que se trata depois.', 950),
  ('projetos.cronograma.inicio', '/dashboard/projetos/obras/[id]/cronograma', 'Cronograma', 'Início',
   'A data prevista para começar a tarefa.', 'Posiciona a barra no cronograma e decide se a tarefa está atrasada.',
   '10/11/2026', 'Colocar o início depois do fim; o sistema recusa.', 951),
  ('projetos.cronograma.fim', '/dashboard/projetos/obras/[id]/cronograma', 'Cronograma', 'Fim',
   'A data prevista para terminar a tarefa (o dia do fim conta).', 'Define o tamanho da barra. Passou do fim sem 100% concluído, a tarefa aparece como atrasada.',
   '20/11/2026', 'Esquecer de atualizar o fim quando a tarefa atrasa de verdade.', 952),
  ('projetos.cronograma.percentual', '/dashboard/projetos/obras/[id]/cronograma', 'Cronograma', 'Percentual concluído',
   'Quanto da tarefa já foi feito, de 0 a 100.', 'Preenche a barra e mostra o avanço físico da obra.',
   '40', 'Informar o percentual do orçamento gasto em vez do trabalho executado.', 953),
  ('projetos.cronograma.predecessora', '/dashboard/projetos/obras/[id]/cronograma', 'Cronograma', 'Começa depois de',
   'A tarefa que precisa terminar antes desta começar. Opcional.', 'Mostra a ordem de execução. O sistema recusa ligações que formam um círculo.',
   'Contrapiso — galpão 2 depois de Terraplenagem', 'Ligar duas tarefas uma na outra; o sistema avisa “Dependência circular”.', 954),
  ('projetos.cronograma.linha_base', '/dashboard/projetos/obras/[id]/cronograma', 'Cronograma', 'Linha de base',
   'Clique quando o cronograma estiver aprovado com o cliente.', 'Guarda as datas combinadas; depois a barra cinza fina mostra o planejado contra o que mudou.',
   'Gravar a linha de base na assinatura do contrato.', 'Gravar de novo no meio da obra: a linha anterior é substituída.', 955)
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_obras_id_cronograma', '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'Cronograma da obra',
        'Tarefas com datas, avanço, dependências e linha de base', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
