-- HB1: "?" e registro da tela "Mão de obra da obra" (lançar horas, #2687). Só dado aditivo (ajuda + system_screens).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Mão de obra da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/mao-de-obra', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.obra_mo.data', 'Data', 'O dia em que a equipe trabalhou.', 'Define a que dia o custo pertence.', 'Hoje, ou o dia da medição.', 'Lançar tudo no mesmo dia em vez de na data real.', 1),
 ('projetos.obra_mo.funcao', 'Função', 'Escolha a função cadastrada; o custo da hora vem sozinho quando a função tem valor.', 'Agrupa o custo por tipo de profissional.', 'Pedreiro.', 'Deixar sem função e esquecer de informar o custo da hora.', 2),
 ('projetos.obra_mo.horas', 'Horas', 'Total de horas trabalhadas, maior que zero. Aceita vírgula.', 'Multiplicado pelo custo da hora gera o valor do lançamento.', '8 ou 7,5.', 'Informar dias no lugar de horas.', 3),
 ('projetos.obra_mo.custo_hora', 'Custo da hora (R$)', 'Quanto custa uma hora dessa função, com encargos.', 'Horas × custo da hora entra no custo e na margem da obra.', '30,00.', 'Usar o valor do dia no lugar do valor da hora.', 4),
 ('projetos.obra_mo.descricao', 'Observação', 'Texto livre opcional: o que foi feito.', 'Ajuda a conferir o lançamento depois.', 'Assentamento do piso, sala.', 'Colocar valores aqui em vez de nos campos próprios.', 5),
 ('projetos.obra_mo.lista', 'Lançamentos', 'Nada a preencher: lista as horas lançadas na obra; Excluir remove o lançamento e tira o custo do resultado.', 'Mostra de onde vem a coluna Mão de obra do Resultado por obra.', 'Pedreiro, 8 h × R$ 30,00 = R$ 240,00.', 'Excluir sem querer: o custo da obra diminui.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, prioridade_monitoramento)
VALUES ('dashboard.projetos_obras_id_mao_de_obra', '/dashboard/projetos/obras/[id]/mao-de-obra', 'hub_construcao', 'Mão de obra da obra', 'Lançar e excluir horas de mão de obra por obra (alimenta o resultado)', 'parcial', 'alta')
ON CONFLICT (id) DO NOTHING;
