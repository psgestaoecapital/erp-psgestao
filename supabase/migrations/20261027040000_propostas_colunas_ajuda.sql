-- Hub Propostas (auditor 26/10): faltava o "?" (RD-95) nas colunas Número, Cliente, Status, Emissão e Total.
-- Só acrescenta textos de ajuda. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.numero', 'Número da proposta', 'Nada a preencher: o número é gerado sozinho, em sequência, quando a proposta é criada.', 'Identifica a proposta para o cliente e para o time; é o que você cita ao falar dela.', 'PROP-2026-0042.', 'Procurar pelo nome do cliente quando só tem o número: use a busca acima, ela aceita os dois.', 18),
 ('projetos.propostas.cliente', 'Cliente da proposta', 'Nada a preencher aqui: é o cliente escolhido ao montar a proposta.', 'Mostra para quem o preço foi enviado.', 'FC Pisos Industriais.', 'Cliente com nome parecido: confira o cadastro antes de enviar.', 19),
 ('projetos.propostas.status_coluna', 'Situação da proposta', 'Nada a preencher: rascunho, enviada, visualizada, aprovada, recusada, expirada ou virou pedido.', 'Mostra em que etapa a proposta está; use o funil acima para filtrar.', 'Enviada: o cliente já recebeu e ainda não respondeu.', 'Achar que aprovada já é faturamento: o pedido nasce em "Virou pedido".', 20),
 ('projetos.propostas.emissao', 'Data de emissão', 'Nada a preencher: dia em que a proposta foi criada.', 'Ajuda a medir há quantos dias o cliente espera ou demora a responder.', '20/10/2026.', 'Confundir com a validade: emissão é quando saiu, validade é até quando o preço vale.', 21),
 ('projetos.propostas.total', 'Total da proposta', 'Nada a preencher: soma dos itens, já com o BDI aplicado.', 'É o valor que o cliente vê e que vira pedido ou obra quando aprovado.', 'R$ 51.467,00.', 'Comparar com custo: o total já inclui margem e BDI, o custo não.', 22)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
