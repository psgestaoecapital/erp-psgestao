-- Revenda · Vendas · modal "Acerto de contas" — RD-95 "?" dos indicadores de financiamento/títulos.
-- Code: desenvolvedor_4_g. Fecha o gap do PDCA (aud8 09/11, tela 90/95): os indicadores de financiamento e de
-- títulos no financeiro (cliente deu/saldo, parcelas, lucro real × projetado) no detalhe do Acerto ainda estavam
-- sem "?". Aditiva e idempotente (catálogo global de ajuda, sem company_id, sem dado de cliente).
-- Prova RD-38:
--   antes: SELECT count(*) FROM public.erp_ajuda_campo
--          WHERE chave IN ('revenda.vendas.acerto_previsto','revenda.vendas.acerto_realizado');  => 0
--   depois: => 2  (mesma contagem das demais linhas da tela preservada; nada é apagado).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('revenda.vendas.acerto_previsto', '/dashboard/revenda/vendas', 'Vendas e entrega', 'revenda',
   'Previsto (preço, custo e lucro projetado)',
   'Nada a preencher aqui: são números do cadastro da venda e do custo do veículo. O preço de venda vem do fechamento; o custo real soma compra, preparação e despesas do veículo.',
   'Mostra o resultado esperado da venda antes de conferir o que realmente entrou: Lucro projetado = Preço de venda − Custo real. Serve de base para comparar com o Realizado ao lado.',
   'Preço de venda R$ 60.000 − Custo real R$ 48.000 = Lucro projetado R$ 12.000.',
   'Lucro projetado não é lucro no bolso: ele conta a venda inteira (inclusive o que o cliente ou o banco ainda devem). O que já entrou aparece no Realizado.',
   7),
  ('revenda.vendas.acerto_realizado', '/dashboard/revenda/vendas', 'Vendas e entrega', 'revenda',
   'Realizado (recebido, em aberto e lucro real)',
   'Nada a preencher aqui: os valores vêm dos recebimentos e dos títulos no financeiro (GE). "Recebido" é o que já caiu; "Em aberto — cliente" e "Em aberto — banco" são as parcelas e o retorno do banco que ainda faltam.',
   'Mostra o resultado já confirmado: Lucro real conta só o que entrou. O que está em aberto (cliente e banco, inclusive o retorno do banco) entra no lucro real quando for pago. Os custos lançados depois da venda já estão dentro do custo real; aparecem à parte só para conferência.',
   'Recebido R$ 40.000, Em aberto — cliente R$ 15.000, Em aberto — banco R$ 5.000 → o lucro real sobe conforme esses R$ 20.000 forem pagos.',
   'Estranhar o lucro real baixo com a venda fechada: confira "Em aberto — cliente/banco"; enquanto houver saldo, ele ainda não entrou no lucro real.',
   7)
ON CONFLICT (chave) DO NOTHING;
