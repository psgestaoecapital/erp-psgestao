-- Compras & Cotações (/dashboard/commerce/compras) · modal "Nova Cotação" passos
-- "Itens" e "Fornecedores" — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): no assistente de nova cotação da tela Compras, os títulos dos
--   passos "Itens a cotar" e "Fornecedores convidados" não tinham "?". Os campos
--   do passo "Identificação" já ganharam ajuda (migration 20261117150545).
-- CORREÇÃO (aditiva, idempotente): os 2 rótulos de seção passam a ter "?";
--   2 chaves NOVAS no grupo "Compras & Cotações".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.cot_itens', '/dashboard/commerce/compras', 'Compras & Cotações', 'Itens a cotar',
   'A lista do que você quer comprar. Em cada linha busque o produto do cadastro (nome ou código) ou digite um item livre, e informe quantidade e unidade.',
   'É o que os fornecedores vão precificar. Buscar do cadastro mantém o histórico de preços; item livre é auto-cadastrado ao receber a compra.',
   'Chapa de drywall 12,5 mm · 50 un · Massa para junta · 20 kg.',
   'Digitar o nome e não escolher na lista deixa o item sem vínculo ao cadastro — selecione o produto ou confirme como item livre.',
   'geral', 9248),
  ('commerce.compras.cot_fornecedores', '/dashboard/commerce/compras', 'Compras & Cotações', 'Fornecedores convidados',
   'Os fornecedores que vão receber este pedido de preço. Busque por nome ou CNPJ (mínimo 2 caracteres) e marque quantos quiser.',
   'Define para quem a cotação é enviada; quanto mais fornecedores, mais propostas para comparar e melhor o preço de compra.',
   'Convide 3 fornecedores do ramo para ter base de comparação.',
   'Convidar um só fornecedor tira a comparação de preços — chame pelo menos dois ou três.',
   'geral', 9249)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
