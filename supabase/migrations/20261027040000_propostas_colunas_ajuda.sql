-- Auditor FC (26/10) em /dashboard/projetos/propostas: faltava o "?" (RD-95) nas colunas Número, Cliente, Status, Emissão e Total.
-- Só acrescenta os textos do "?". Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.col_numero', 'Número da proposta', 'Nada a preencher: o sistema numera cada proposta em sequência.', 'Identifica a proposta para o cliente e para a equipe; use na conversa e no pedido.', 'PROP-2026-0012.', 'Procurar pelo nome da obra: o número é único, o nome pode repetir.', 20),
 ('projetos.propostas.col_cliente', 'Cliente da proposta', 'Nada a preencher aqui: é o cliente escolhido ao criar a proposta.', 'Mostra para quem o preço foi enviado e vira o cliente da obra quando a proposta é aprovada.', 'FC Pisos Industriais Ltda.', 'Criar a proposta com cliente errado: corrija antes de enviar.', 21),
 ('projetos.propostas.col_status', 'Situação da proposta', 'Nada a preencher: rascunho, enviada, visualizada, aprovada, recusada, expirada ou virou pedido.', 'Mostra em que etapa a negociação está e quem precisa agir.', 'Enviada: aguardando resposta do cliente.', 'Achar que aprovada já gerou faturamento: o pedido nasce em "Virou pedido".', 22),
 ('projetos.propostas.col_emissao', 'Data de emissão', 'Nada a preencher: dia em que a proposta foi criada ou enviada.', 'Ajuda a contar há quanto tempo o cliente está sem resposta.', '20/10/2026.', 'Confundir com a validade: a emissão é quando saiu, a validade é até quando o preço vale.', 23),
 ('projetos.propostas.col_total', 'Total da proposta', 'Nada a preencher: soma dos itens com BDI e impostos da proposta.', 'É o valor que o cliente vai pagar se aprovar; base da receita prevista da obra.', 'R$ 51.467,00.', 'Comparar com o custo: o total já inclui margem e BDI.', 24)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
