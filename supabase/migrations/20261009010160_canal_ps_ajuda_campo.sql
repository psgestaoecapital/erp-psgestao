-- Canal PS · "?" (RD-95) dos campos do painel Meu Code e do filtro de data da aba Codes. Aditiva: só texto de ajuda novo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Codes', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.meu_code.assunto', 'Assunto', 'Uma frase curta dizendo o que você quer do seu Code.', 'É o título do pedido na caixa do seu Code e na lista "Meus pedidos".', 'Corrigir o saldo do relatório de contas a pagar da empresa X.', 'Assunto genérico ("ajuda"): o Code não sabe a prioridade.', 1),
 ('dev.meu_code.texto', 'O que o Code deve fazer', 'Descreva o que está errado ou o que precisa existir, o que você esperava ver e onde.', 'É a tarefa que o seu Code lê e executa; quanto mais claro, menos idas e vindas.', 'Na tela de títulos, o total do mês não bate com o extrato; esperado R$ 10.000.', 'Colar dado pessoal de cliente: descreva sem CPF ou senha.', 2),
 ('dev.meu_code.chamado', 'Chamado nº (opcional)', 'O número do chamado de suporte relacionado, se houver.', 'Liga o pedido ao chamado; só vale para chamados da sua carteira.', '1234', 'Número de chamado de outra carteira: o pedido é recusado.', 3),
 ('dev.meu_code.empresa', 'Empresa da carteira (opcional)', 'Escolha a empresa da sua carteira a que o pedido se refere.', 'Limita o trabalho do Code àquela empresa; só aparecem as empresas que você atende.', 'Empresa R.R Comércio.', 'Esperar empresa de outra carteira na lista: ela não aparece.', 4),
 ('dev.meu_code.nucleo', 'Mexe no núcleo', 'Marque quando o pedido mexe em permissão, RLS, fiscal ou outra regra de todas as empresas.', 'Pedido de núcleo só vai ao Code depois do OK do CEO.', 'Pedido para mudar quem pode ver salários.', 'Deixar desmarcado um pedido de núcleo: o Code recusa e devolve.', 5),
 ('dev.codes.filtro_data', 'Dia das publicações', 'Escolha o dia para ver as publicações (merges) daquele dia.', 'Filtra a linha do tempo "Publicações do dia"; não altera nenhum dado.', 'Hoje, para ver o que foi publicado desde cedo.', 'Escolher dia futuro: não há publicações.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
