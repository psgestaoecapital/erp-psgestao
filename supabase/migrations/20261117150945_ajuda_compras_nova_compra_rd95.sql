-- Compras & Cotações (/dashboard/commerce/compras) · modal "Nova compra" — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): no modal "Nova compra", o campo de busca de Fornecedor e as
--   colunas "Qtd" e "Preço un." da tabela de itens estavam sem "?".
-- CORREÇÃO (aditiva, idempotente): o input de fornecedor ganha "?"; as 2 colunas
--   usam a prop `ajuda` do componente <Th>; 3 chaves NOVAS no grupo
--   "Compras & Cotações".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.compra_fornecedor', '/dashboard/commerce/compras', 'Compras & Cotações', 'Fornecedor da compra',
   'Busque o fornecedor pelo nome, fantasia ou CNPJ (mínimo 2 caracteres) e selecione-o na lista.',
   'Vincula a compra ao fornecedor certo, para o contas a pagar e o histórico de compras saírem no nome dele.',
   'Buscar "Drywall" e escolher o fornecedor cadastrado.',
   'Digitar e não selecionar na lista deixa a compra sem fornecedor vinculado — escolha uma opção da busca.',
   'geral', 9250),
  ('commerce.compras.compra_item_qtd', '/dashboard/commerce/compras', 'Compras & Cotações', 'Quantidade do item',
   'Quantas unidades deste produto estão sendo compradas, na unidade do cadastro do produto.',
   'Multiplica pelo preço unitário para formar o subtotal do item e o total da compra; ao receber, soma ao estoque.',
   '50 (chapas) · 20 (kg de massa).',
   'Quantidade zerada ou errada distorce o total da compra e a entrada no estoque — confira antes de salvar.',
   'geral', 9251),
  ('commerce.compras.compra_item_preco', '/dashboard/commerce/compras', 'Compras & Cotações', 'Preço unitário',
   'O preço de compra de uma unidade do produto, sem contar frete e descontos gerais da compra.',
   'Forma o subtotal do item (quantidade × preço) e alimenta o custo médio do produto no estoque.',
   'R$ 38,90 por chapa.',
   'Informar o valor total da linha no lugar do unitário multiplica o custo pela quantidade — use o preço de uma unidade.',
   'geral', 9252)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
