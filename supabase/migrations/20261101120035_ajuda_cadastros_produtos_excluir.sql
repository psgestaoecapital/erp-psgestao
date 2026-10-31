-- RD-95: semeia o "?" (AjudaCampo) do botão Excluir produto em /dashboard/cadastros/produtos.
-- Chamado #3856 (FC Pisos): "botão para deletar o produto". A exclusão é LÓGICA (ativo = false) e
-- bloqueada quando há vínculo (pedidos, NF-e, estoque, etc.). Esta migration só INSERE uma linha de
-- catálogo global (erp_ajuda_campo); é aditiva, não altera dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'cadastros.produtos.excluir',
  '/dashboard/cadastros/produtos',
  'Produtos',
  'Excluir produto',
  'Clique na lixeira da linha do produto e confirme. O produto é inativado (exclusão lógica): some das listas e da busca, mas o registro e o histórico ficam guardados no banco. Antes de excluir, o sistema confere se o produto está em uso.',
  'Tira da operação um produto que não é mais usado, sem apagar o histórico já lançado. Se o produto estiver vinculado a pedidos, orçamentos, notas fiscais (emitidas ou recebidas), movimentações de estoque, inventário, compras, cotações, composição de serviços ou reservas de obra, a exclusão é bloqueada para não quebrar esses lançamentos.',
  'Produto PROD-042 nunca usado em nenhum documento → é inativado na hora. Produto que aparece em 7 notas fiscais → o sistema recusa e sugere apenas inativá-lo.',
  'Tentar excluir um produto já usado em notas ou pedidos: o sistema responde que há vínculo e não exclui. Nesse caso o produto continua disponível; se não quiser mais vê-lo, mantenha-o inativo.',
  'gestao_empresarial',
  0,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
