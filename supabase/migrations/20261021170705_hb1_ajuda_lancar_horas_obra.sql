-- HB1: "?" da tela Lançar horas na obra (usa fn_obra_mao_obra_apontar da #2687). Só dado de ajuda, aditivo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Lançar horas na obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/horas', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.horas_obra.data', 'Data', 'O dia em que a equipe trabalhou.', 'Separa o custo por dia e por competência.', 'Hoje.', 'Lançar tudo numa data só no fim do mês.', 1),
 ('projetos.horas_obra.funcao', 'Função', 'Escolha a função cadastrada em Mão de obra (pedreiro, gesseiro...). Pode ficar sem função.', 'Traz o custo da hora cadastrado e agrupa o custo por função.', 'Gesseiro.', 'Escolher a função errada e conferir o custo da hora na linha.', 2),
 ('projetos.horas_obra.horas', 'Horas', 'Quantas horas foram trabalhadas, maior que zero. Aceita vírgula (7,5).', 'Horas × custo da hora é o custo de mão de obra da obra.', '8 h.', 'Lançar a quantidade de pessoas em vez das horas.', 3),
 ('projetos.horas_obra.custo_hora', 'Custo da hora (R$)', 'Quanto custa uma hora dessa função, com encargos. Vem da função, mas você pode ajustar.', 'Entra no custo e na margem do Resultado por obra.', 'R$ 30,00 × 40 h = R$ 1.200,00.', 'Deixar zerado: o custo não aparece no resultado.', 4),
 ('projetos.horas_obra.descricao', 'O que foi feito', 'Texto livre, opcional: a atividade do dia.', 'Ajuda a conferir o lançamento depois.', 'Montagem do forro do 2º andar.', 'Deixar vazio e depois não saber de que dia era.', 5),
 ('projetos.horas_obra.lancar', 'Lançar horas', 'Confere os campos e grava o lançamento na obra.', 'Faz o custo entrar na hora no Resultado por obra. Pode ser excluído na lista (com confirmação).', 'Clique uma vez; o lançamento aparece na tabela.', 'Clicar duas vezes e duplicar: confira a tabela antes de repetir.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
