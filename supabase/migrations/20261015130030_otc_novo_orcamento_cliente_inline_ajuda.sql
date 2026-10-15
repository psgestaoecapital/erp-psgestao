-- #2910 · "?" (RD-95) do cadastro inline de cliente no Novo Orçamento (OTC). Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('otc.novo.cliente_novo_nome', 'Novo orçamento', 'Nome / razão social do novo cliente',
 'Nome da pessoa ou razão social da empresa. Já vem preenchido com o que você digitou na busca.',
 'É o nome que sai no orçamento, na nota e no financeiro.', 'João da Silva', 'Abreviar o nome e depois a nota sair com nome diferente do documento.', 10, '/dashboard/commerce/otc', 'comercio', 'publicado'),
('otc.novo.cliente_novo_doc', 'Novo orçamento', 'CPF / CNPJ do novo cliente',
 'Só números ou com pontuação. Se for CNPJ, ao sair do campo o sistema tenta puxar o nome da Receita.',
 'Evita cliente duplicado (o mesmo documento reaproveita o cadastro existente) e é exigido para emitir nota.', '12.345.678/0001-90', 'Digitar o documento incompleto.', 20, '/dashboard/commerce/otc', 'comercio', 'publicado'),
('otc.novo.cliente_novo_tel', 'Novo orçamento', 'Telefone do novo cliente',
 'Telefone com DDD para contato.',
 'Fica no cadastro do cliente para o atendimento e o WhatsApp.', '(11) 98888-7777', 'Esquecer o DDD.', 30, '/dashboard/commerce/otc', 'comercio', 'publicado')
ON CONFLICT (chave) DO NOTHING;
