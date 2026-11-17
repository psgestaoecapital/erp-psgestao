-- Commerce · Compras & Cotações (/dashboard/commerce/compras) — RD-95: "?" das COLUNAS das listas
-- ============================================================================
-- GAP (PDCA aud8): o #4831 cobriu os controles do topo (abas, busca, filtro, botões), mas as COLUNAS
--   das tabelas (Cotações e Pedidos de Compra) ainda não tinham "?". RD-95 pede ajuda em todo campo,
--   coluna e indicador que o usuário lê.
-- CORREÇÃO (aditiva, idempotente): doze chaves em erp_ajuda_campo para os cabeçalhos das duas tabelas;
--   o front (page.tsx) passa a renderizar <AjudaCampo chave="..."> em cada <Th>.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.col_numero', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Número',
   'Número sequencial do registro (da cotação ou do pedido de compra), gerado pelo sistema.',
   'Identifica a cotação/pedido para você citar em conversas, no financeiro e no recebimento.',
   '00123', 'O número é gerado automaticamente — não é digitado por você.', 'gestao_empresarial', 110),

  ('commerce.compras.col_descricao', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Descrição',
   'Resumo do que está sendo cotado (o título que você deu à cotação).',
   'Mostra num relance o assunto da cotação sem precisar abri-la.',
   'Materiais de drywall para a obra Centro', '—', 'gestao_empresarial', 120),

  ('commerce.compras.col_solicitante', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Solicitante',
   'Quem pediu a cotação (a pessoa que a abriu).',
   'Permite saber a quem recorrer com dúvidas sobre aquela cotação.',
   'Maria (Compras)', '—', 'gestao_empresarial', 130),

  ('commerce.compras.col_abertura', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Abertura',
   'Data em que a cotação foi criada.',
   'Mede há quanto tempo a cotação está em andamento, para cobrar propostas atrasadas.',
   '05/11/2026', '—', 'gestao_empresarial', 140),

  ('commerce.compras.col_limite', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Limite',
   'Data limite para os fornecedores enviarem a proposta.',
   'Ajuda a priorizar as cotações que estão vencendo o prazo de resposta.',
   '12/11/2026', 'Vazio ("—") quando a cotação não tem prazo definido.', 'gestao_empresarial', 150),

  ('commerce.compras.col_status', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Status',
   'Situação atual do registro (ex.: rascunho, enviada, aprovada, cancelada, aguardando entrega, recebida).',
   'Mostra em que fase está a cotação/pedido, para saber o próximo passo.',
   'Aguardando entrega', '—', 'gestao_empresarial', 160),

  ('commerce.compras.col_acoes', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Ações',
   'Atalhos para agir na linha — por exemplo, "Comparar" as propostas recebidas lado a lado.',
   'Executa a ação principal da cotação sem precisar abrir o detalhe.',
   'Clicar em "Comparar" para ver as propostas dos fornecedores', '—', 'gestao_empresarial', 170),

  ('commerce.compras.col_fornecedor', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Fornecedor',
   'Fornecedor escolhido para o pedido de compra.',
   'Identifica de quem a compra foi feita, para conferir recebimento e financeiro.',
   'Fornecedor Alfa Ltda', '—', 'gestao_empresarial', 180),

  ('commerce.compras.col_pedido', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Pedido',
   'Data em que o pedido de compra foi feito.',
   'Mostra quando a compra foi registrada, base para prazos de entrega e pagamento.',
   '06/11/2026', '—', 'gestao_empresarial', 190),

  ('commerce.compras.col_prev_entrega', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Prev. entrega',
   'Data prevista para a entrega da compra.',
   'Ajuda a acompanhar o que está por chegar e cobrar entregas atrasadas.',
   '15/11/2026', 'Vazio ("—") quando o fornecedor não informou a previsão.', 'gestao_empresarial', 200),

  ('commerce.compras.col_total', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna Total',
   'Valor total do pedido de compra (soma dos itens).',
   'Mostra quanto a compra representa, para controle de gasto e geração do financeiro.',
   'R$ 4.250,00', '—', 'gestao_empresarial', 210),

  ('commerce.compras.col_nf', '/dashboard/commerce/compras', 'Compras & Cotações', 'Coluna NF',
   'Indica se já há nota fiscal de entrada vinculada ao pedido.',
   'Sinaliza se a compra foi recebida com nota (atualiza estoque e financeiro) ou ainda está pendente.',
   'NF 000987 vinculada', 'Sem NF ainda: a compra foi pedida mas não recebida/faturada.', 'gestao_empresarial', 220)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
