-- #2260 · "?" (RD-95) dos campos do cadastro inline de cliente na Nova OS. Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('os.nova.cliente', 'Nova OS', 'Cliente (opcional)',
 'Digite parte do nome ou o CNPJ/CPF para achar um cliente já cadastrado. Se não achar, use "+ Cadastrar novo cliente" sem sair da tela.',
 'O cliente fica vinculado à OS e aparece no orçamento, na nota e no financeiro.',
 'Auto Peças Silva', 'Deixar a OS sem cliente e depois não conseguir emitir a nota.', 10, '/dashboard/os', 'oficina', 'publicado'),
('os.nova.cliente_novo_nome', 'Nova OS', 'Nome / razão social do novo cliente',
 'Nome da pessoa ou razão social da empresa. Já vem preenchido com o que você digitou na busca.',
 'É o nome que sai na OS, no orçamento e na nota.', 'João da Silva', 'Abreviar o nome e depois a nota sair com nome diferente do documento.', 20, '/dashboard/os', 'oficina', 'publicado'),
('os.nova.cliente_novo_doc', 'Nova OS', 'CPF / CNPJ do novo cliente',
 'Só números ou com pontuação. Se for CNPJ, ao sair do campo o sistema tenta puxar o nome da Receita.',
 'Evita cliente duplicado (o mesmo documento reaproveita o cadastro existente) e é exigido para emitir nota.', '12.345.678/0001-90', 'Digitar o documento incompleto.', 30, '/dashboard/os', 'oficina', 'publicado'),
('os.nova.cliente_novo_tel', 'Nova OS', 'Telefone do novo cliente',
 'Telefone com DDD para contato e aviso de OS pronta.',
 'Fica no cadastro do cliente para o atendimento e o WhatsApp.', '(11) 98888-7777', 'Esquecer o DDD.', 40, '/dashboard/os', 'oficina', 'publicado')
ON CONFLICT (chave) DO NOTHING;
