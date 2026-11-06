-- "?" (RD-95) da tela Obras do Hub: formulário "Adicionar item" do escopo e "Dados fiscais da obra" (NFS-e). Aditiva: só linhas de ajuda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.obras.item_descricao', 'Escopo da obra', 'Descrição do item',
 'Nome do serviço ou material contratado, do jeito que o cliente entende.',
 'É o texto que aparece no escopo, nas medições e no resultado da obra.', 'Parede drywall ST 12,5 mm duas faces', 'Descrição genérica demais ("serviços"), que impede medir o andamento depois.', 10, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.item_unidade', 'Escopo da obra', 'Unidade do item',
 'Unidade de medida do item: m², m, un, vb, h.',
 'Define como a quantidade é medida e como o preço unitário é lido.', 'm²', 'Misturar unidades (m² no contrato e m na medição).', 20, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.item_quantidade', 'Escopo da obra', 'Quantidade contratada',
 'Quantidade total prevista para o item, na unidade escolhida.',
 'Base do valor contratado (quantidade × preço) e do percentual medido a cada medição.', '120', 'Colocar a quantidade já executada em vez da contratada.', 30, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.item_preco', 'Escopo da obra', 'Preço por unidade (R$)',
 'Valor cobrado do cliente por unidade do item, em reais.',
 'Multiplicado pela quantidade dá o valor contratado do item e compõe o valor previsto da obra.', '85,00', 'Usar o custo em vez do preço de venda.', 40, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.fiscal_cno', 'Dados fiscais da obra', 'CNO (Cadastro Nacional de Obras)',
 'Número do CNO da obra, emitido pela Receita Federal.',
 'Vai na NFS-e de construção (exigência E0370). Sem CNO ou código municipal a nota não sai.', '12.345.67890/12', 'Digitar o CNPJ do cliente no lugar do CNO.', 50, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.fiscal_codigo_municipal', 'Dados fiscais da obra', 'Código de obra municipal',
 'Código de obra da prefeitura, só se o município exigir.',
 'Alternativa ao CNO na NFS-e de construção em municípios que usam código próprio.', 'OB-2026-0451', 'Preencher sem o município exigir, gerando divergência na nota.', 60, '/dashboard/projetos/obras', 'projetos', 'publicado'),
('projetos.obras.fiscal_art', 'Dados fiscais da obra', 'ART / RRT',
 'Número da ART (engenheiro) ou RRT (arquiteto) da obra. Opcional.',
 'Registra o responsável técnico na nota e no dossiê da obra.', '1020260123456', 'Informar ART de outra obra.', 70, '/dashboard/projetos/obras', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
