-- Cotações de compra (/dashboard/cotacoes) · grade comparativa de propostas — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): a grade de comparação do modal "Comparar" (preço por item de
--   cada fornecedor, frete, condição de pagamento, prazo de entrega) não tinha "?".
-- CORREÇÃO (aditiva, idempotente): 1 chave NOVA no grupo "Cotações", ancorada no
--   cabeçalho da tabela (o detector RD-95 trata todos os campos da <table> como
--   cobertos por um "?" dentro dela).
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('cotacoes.comparar.grade', '/dashboard/cotacoes', 'Cotações', 'Comparação das propostas',
   'Lance o preço unitário de cada item para cada fornecedor e, nas linhas de baixo, o frete, a condição de pagamento e o prazo de entrega de cada um.',
   'O sistema soma os totais, destaca em verde o menor preço de cada item e aponta o fornecedor vencedor, para você decidir a compra com os números na mesma tela.',
   'Fornecedor A R$ 10,00/un, frete R$ 50, 30 dias, 7 dias de prazo × Fornecedor B R$ 9,50/un, frete R$ 90 — o total decide.',
   'Comparar só pelo preço unitário e esquecer frete, prazo e condição de pagamento pode fazer você escolher a proposta mais cara no total.',
   'geral', 9242)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
