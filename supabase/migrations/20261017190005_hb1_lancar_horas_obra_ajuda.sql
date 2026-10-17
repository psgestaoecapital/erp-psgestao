-- HB1: "?" da tela Lançar horas na obra (apontamento de mão de obra, #2687). Só dado de ajuda, aditivo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/horas', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.horas_obra.obra', 'Lançar horas', 'Obra', 'Escolha a obra em que a equipe trabalhou.', 'O custo das horas entra no resultado dessa obra.', 'OB-0012 · Reforma sala 3.', 'Lançar na obra errada: exclua o lançamento e refaça na obra certa.', 10),
 ('projetos.horas_obra.data', 'Lançar horas', 'Data', 'Dia em que o trabalho foi feito.', 'Organiza o histórico de horas da obra.', 'Hoje.', 'Usar a data do lançamento em vez da data do trabalho.', 11),
 ('projetos.horas_obra.funcao', 'Lançar horas', 'Função', 'Escolha a função da Mão de obra (opcional). Ao escolher, o custo da hora é sugerido.', 'Identifica quem trabalhou e sugere o custo da hora cadastrado.', 'Pedreiro.', 'Esquecer de cadastrar a função antes em Mão de obra.', 12),
 ('projetos.horas_obra.horas', 'Lançar horas', 'Horas', 'Total de horas trabalhadas (maior que zero).', 'Multiplicado pelo custo da hora, vira o custo de mão de obra da obra.', '8 horas.', 'Digitar minutos como horas (30 em vez de 0,5).', 13),
 ('projetos.horas_obra.custo_hora', 'Lançar horas', 'Custo da hora', 'Valor de uma hora desta pessoa ou função, em reais.', 'Valor do lançamento = horas × custo da hora; entra no custo e na margem da obra.', 'R$ 30,00.', 'Deixar zerado: o lançamento não gera custo.', 14),
 ('projetos.horas_obra.descricao', 'Lançar horas', 'Descrição', 'O que foi feito (opcional).', 'Ajuda a conferir o lançamento depois.', 'Assentamento de piso.', 'Deixar vazio e depois não lembrar do serviço.', 15),
 ('projetos.horas_obra.lancar', 'Lançar horas', 'Lançar', 'Confere os campos e grava o lançamento.', 'Soma o custo na coluna Mão de obra do Resultado por obra.', 'Clique em Lançar horas.', 'Clicar duas vezes seguidas e duplicar o lançamento.', 16),
 ('projetos.horas_obra.excluir', 'Lançar horas', 'Excluir lançamento', 'Remove o lançamento da lista (exclusão lógica, fica registrado quem excluiu).', 'Tira o valor do custo da obra.', 'Lançamento duplicado.', 'Excluir achando que dá para editar: refaça com os valores certos.', 17)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
