-- Hub/Propostas (auditor 26/10): "?" (RD-95) nas colunas Número, Cliente, Status, Emissão e Total. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.col_numero', 'Número da proposta', 'Nada a preencher: o sistema numera cada proposta em sequência.', 'Identifica a proposta em conversas com o cliente e vira o código do pedido e da obra.', 'PRO-2026-0042.', 'Mudar o número no papel: o cliente passa a citar uma proposta que o sistema não acha.', 20),
 ('projetos.propostas.col_cliente', 'Cliente da proposta', 'Nada a preencher aqui: é o cliente escolhido ao criar a proposta.', 'Define para quem o preço vale e quem recebe o pedido e a cobrança.', 'Frigorífico Boa Carne Ltda.', 'Criar a proposta com o cliente errado: troque antes de enviar.', 21),
 ('projetos.propostas.col_status', 'Status da proposta', 'Nada a preencher: acompanha a proposta de rascunho a enviada, aprovada, recusada ou virou pedido.', 'Mostra em que etapa do funil a proposta está e o que falta fazer.', 'Enviada: aguardando o cliente responder.', 'Achar que aprovada já gerou obra: a obra nasce ao virar pedido.', 22),
 ('projetos.propostas.col_emissao', 'Data de emissão', 'Nada a preencher: dia em que a proposta foi criada.', 'Com a validade, mostra há quantos dias o cliente está sem resposta.', '12/10/2026.', 'Confundir emissão com envio: a proposta pode ficar em rascunho depois de emitida.', 23),
 ('projetos.propostas.col_total', 'Total da proposta', 'Nada a preencher: soma dos itens com o BDI aplicado.', 'É o valor que o cliente paga se aprovar; base da margem e do faturamento da obra.', 'R$ 51.467,00.', 'Comparar com o custo sem BDI: o total já inclui impostos e lucro.', 24)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
