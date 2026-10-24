-- HB2 (RD-95): "?" em cada campo do cadastro de faixas, condições e códigos de /dashboard/projetos/tabelas-preco.
-- Só acrescenta textos de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.f_codigo_servico', 'Código do serviço', 'Um código curto e único para o serviço, sem espaços.', 'Liga as faixas do mesmo serviço entre si e à medição.', 'uretano-6mm', 'Usar um código diferente para cada faixa do mesmo serviço: as faixas não se juntam.', 20),
 ('hub.tabela_preco.f_nome_servico', 'Nome do serviço', 'O nome como aparece no contrato do cliente.', 'É o texto que o cliente vê na proposta e na medição.', 'Piso de uretano 6 mm', 'Abreviar de um jeito que o cliente não reconhece.', 21),
 ('hub.tabela_preco.f_unidade', 'Unidade', 'A unidade de cobrança do serviço.', 'Define em que o preço é cobrado: m², m, un, hora.', 'm²', 'Misturar m² e m na mesma tabela para o mesmo serviço.', 22),
 ('hub.tabela_preco.f_faixa_de', 'Faixa — de', 'A quantidade em que esta faixa começa.', 'Marca onde a faixa de preço começa a valer.', '0 ou 100', 'Deixar faixas que se sobrepõem: o cálculo pega a primeira que encontrar.', 23),
 ('hub.tabela_preco.f_faixa_ate', 'Faixa — até', 'A quantidade em que a faixa termina. Vazio = vale daí em diante.', 'Fecha a faixa; a última faixa fica sem limite.', '300', 'Preencher a última faixa e deixar quantidades grandes sem preço.', 24),
 ('hub.tabela_preco.f_preco_base', 'Preço base', 'O preço por unidade na condição normal, em reais.', 'É o preço da medição; adicionais e preços fixos partem dele.', '98,00', 'Digitar o total da obra em vez do preço por unidade.', 25),
 ('hub.tabela_preco.f_condicao', 'Condição', 'O nome da condição, como sabado, noturno ou domingo.', 'Cria uma coluna de preço além da normal.', 'sabado', 'Escrever de jeitos diferentes (sábado / sabado): viram condições separadas.', 26),
 ('hub.tabela_preco.f_adicional_pct', 'Adicional (%)', 'O acréscimo percentual sobre o preço base nessa condição.', 'Calcula o preço da condição sem digitar um valor por faixa.', '50 (= +50%)', 'Digitar 1,5 achando que é 150%: o campo é em porcentagem.', 27),
 ('hub.tabela_preco.f_cod_condicao', 'Condição do código', 'Escolha a condição a que o código do cliente se aplica.', 'O mesmo serviço pode ter um código por condição.', 'Domingo', 'Salvar o código na condição errada.', 28),
 ('hub.tabela_preco.f_codigo_cliente', 'Código no cliente', 'O código do item no sistema do cliente. Vazio remove o código.', 'Faz a medição bater com o pedido de compra do cliente.', 'VV-FOR-01D', 'Copiar o código do nosso catálogo em vez do código do cliente.', 29),
 ('hub.tabela_preco.f_preco_fixo', 'Preço fixo da condição', 'Opcional: um preço fechado para esta condição, em reais.', 'Substitui o adicional (%) quando o contrato fixa o preço.', '135,00', 'Esperar que o adicional ainda seja somado: o preço fixo o substitui.', 30)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
