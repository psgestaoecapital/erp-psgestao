-- HB2 · Propostas dentro do Hub: "?" dos 2 filtros. Aditiva (só texto de ajuda novo; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.propostas.busca', 'Propostas', 'Buscar proposta', 'Digite parte do número da proposta ou do nome do cliente.', 'Encontra a proposta na lista sem rolar a tela.', 'Digite "Tryo" ou "ORC-0042".', 'Digitar o CNPJ: aqui a busca é por número ou nome.', 10, '/dashboard/projetos/propostas'),
 ('projetos.propostas.status', 'Propostas', 'Situação da proposta', 'Escolha a situação para ver só as propostas nela, ou "Todos os status".', 'Separa o que ainda espera resposta do cliente do que já virou pedido.', 'Enviado: o cliente recebeu e ainda não respondeu.', 'Achar que "Aprovado" já é pedido: o pedido nasce depois, em "Virou pedido".', 11, '/dashboard/projetos/propostas')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
