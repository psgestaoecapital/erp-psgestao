-- Chamado #3255 (Gean · pedido do CEO, vale para todas as empresas): na tela Cadastros › Produtos o botão "Novo produto"
-- ficava fora da tela (último de 7 botões numa barra sem quebra de linha). Agora vem primeiro, em destaque, e o
-- formulário ganhou "Salvar e cadastrar outro". Esta migration só traz o texto do "?" (RD-95) das duas ações.
-- Aditiva: INSERT em erp_ajuda_campo com ON CONFLICT DO NOTHING. Sem função, view, policy, UPDATE ou DELETE.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('cadastros.produtos.novo', '/dashboard/cadastros/produtos', 'Produtos', 'Novo produto',
  'Abre o formulário para cadastrar um produto. O código já vem sugerido (o próximo da sequência da empresa); preencha nome e unidade, o NCM e os impostos na aba Fiscal e o preço de venda na aba Preços.',
  'O produto passa a aparecer na venda, na OS, na nota fiscal e no estoque. Com NCM e CST preenchidos ele nasce sem pendência fiscal; com preço de venda ele não trava a venda.',
  'Último código cadastrado PROD-041 → sugere PROD-042. NCM 87089990, CSOSN 102, preço de venda R$ 89,90.',
  'Salvar sem preço de venda ou com NCM incompleto: o sistema avisa e não grava. Usar um código que já existe na empresa: escolha outro.',
  'gestao_empresarial', 'publicado'),
 ('cadastros.produtos.salvar_outro', '/dashboard/cadastros/produtos', 'Produtos', 'Salvar e cadastrar outro',
  'Grava este produto e abre o formulário de novo, limpo, com o próximo código sugerido.',
  'Agiliza o cadastro de vários itens em sequência, sem fechar e abrir a janela a cada produto.',
  'Cadastrou "Filtro de óleo PSL 55" (PROD-042) → o formulário reabre com PROD-043.',
  'Esperar que os dados fiscais sejam copiados: para aproveitar os dados de um item parecido use "Clonar" na linha do produto.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
