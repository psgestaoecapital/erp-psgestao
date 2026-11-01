-- Chamado #2710 (FCR · caixa jordana-code a155726a), última parte: na entrada da nota de compra (Documentos recebidos /
-- Mutirão) o produto vinculado mostra o preço de venda SUGERIDO pelo markup padrão dele (ou o geral), editável, e grava pelo
-- fn_produto_preco_aplicar já existente (histórico em erp_preco_historico). Esta migration só traz o texto do "?" (RD-95).
-- Aditiva: um INSERT em erp_ajuda_campo com ON CONFLICT DO NOTHING. Sem função, view, policy, UPDATE ou DELETE.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('compras.entrada.preco_venda_sugerido', '/dashboard/compras/documentos-recebidos', 'Entrada da nota', 'Preço de venda',
  'O preço de venda do produto. Ele já vem sugerido pelo custo desta nota mais o markup do produto (ou o markup geral da empresa, se o produto não tiver o próprio). Confira, mude se quiser e clique em "Gravar preço".',
  'Atualiza o preço de venda do produto no cadastro na hora em que a mercadoria chega, com o custo novo. Fica registrado no histórico de preços com o motivo "Entrada da nota de compra".',
  'Custo nesta nota R$ 10,00 e markup do produto 40% → sugere R$ 14,00. Sem markup próprio e geral 30% → R$ 13,00.',
  'Gravar antes de calcular o custo real ou de acertar o fator da embalagem (1 CX = 12 UN): o custo por unidade sai errado e o preço junto. Acerte o fator primeiro.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
