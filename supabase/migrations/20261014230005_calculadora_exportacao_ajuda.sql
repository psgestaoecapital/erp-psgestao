-- Hub HB2: ajuda "?" dos botões WhatsApp e Excel da lista de compra da Calculadora de Obra (aditiva).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calculadora de Obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/calculadora', 'hub', 'publicado'
FROM (VALUES
 ('projetos.calculadora.whatsapp', 'Enviar por WhatsApp', 'Nada a preencher: o botão abre o WhatsApp com a lista pronta e você escolhe o contato.', 'Manda a lista de compra (quantidade, unidade e material) para o fornecedor sem digitar nada.', '33 × pç · Chapa ST 12,5', 'Esperar que a mensagem seja enviada sozinha: você ainda precisa escolher o contato e enviar.', 21),
 ('projetos.calculadora.excel', 'Baixar Excel', 'Nada a preencher: o botão baixa uma planilha com a lista de compra.', 'Gera planilha com material, quantidade, unidade, custo unitário e subtotal, para conferir ou anexar a pedidos.', 'lista-de-compra.csv', 'Material sem produto vinculado sai com custo zero: vincule o produto antes de baixar.', 22)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
