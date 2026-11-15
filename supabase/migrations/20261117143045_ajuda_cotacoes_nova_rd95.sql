-- Cotações de compra (/dashboard/cotacoes) · modal "Nova Cotação" — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): a tela de Cotações (src/app/dashboard/cotacoes/page.tsx) não
--   tinha nenhum "?". Começamos pelos 2 campos do cabeçalho do modal de
--   criação ("Descrição" e "Limite para Respostas").
-- CORREÇÃO (aditiva, idempotente): 2 chaves NOVAS no grupo "Cotações".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('cotacoes.nova.descricao', '/dashboard/cotacoes', 'Cotações', 'Descrição da cotação',
   'Um nome curto que identifique o que você está cotando, para achar a cotação depois na lista.',
   'Aparece na lista de cotações e nos convites aos fornecedores, para todo mundo saber do que se trata o pedido de preço.',
   'Compra mensal de matéria-prima · Reposição de EPIs · Materiais da obra do galpão.',
   'Deixar genérico demais ("compras") faz você confundir uma cotação com outra na lista — descreva o que está sendo cotado.',
   'geral', 9240),
  ('cotacoes.nova.data_limite', '/dashboard/cotacoes', 'Cotações', 'Limite para respostas',
   'A data até quando os fornecedores podem enviar os preços desta cotação.',
   'Organiza o prazo da coleta: depois dessa data você fecha a cotação e compara as propostas recebidas para decidir o vencedor.',
   'Hoje + 5 dias úteis, se você precisa comprar na semana que vem.',
   'Pôr uma data no passado ou curta demais faz o fornecedor não conseguir responder a tempo — dê um prazo realista.',
   'geral', 9241)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
