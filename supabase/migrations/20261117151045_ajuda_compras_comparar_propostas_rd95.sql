-- Compras & Cotações (/dashboard/commerce/compras) · "Comparar propostas" — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): na matriz de comparação de propostas (modal "Comparar"), o campo
--   de preço por fornecedor/item não tinha "?" que explicasse como ler e preencher
--   o quadro.
-- CORREÇÃO (aditiva, idempotente): a coluna "Item" da matriz recebe "?" (via prop
--   `ajuda` do <Th>); 1 chave NOVA no grupo "Compras & Cotações".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.cot_comparar', '/dashboard/commerce/compras', 'Compras & Cotações', 'Comparar propostas',
   'Para cada item da cotação, informe o preço unitário que cada fornecedor cotou na coluna dele. O menor preço do item fica destacado em verde.',
   'Coloca os fornecedores lado a lado para você comparar preço por item e total, e decidir de quem comprar com base no dado.',
   'Item "chapa de drywall": Fornecedor A R$ 38,90, Fornecedor B R$ 41,00 → A fica em verde.',
   'Lançar o preço na coluna do fornecedor errado inverte a comparação — confira o cabeçalho da coluna antes de digitar.',
   'geral', 9253)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
