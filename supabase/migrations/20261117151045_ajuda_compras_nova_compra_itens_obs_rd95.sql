-- Commerce · Nova compra (/dashboard/commerce/compras, modal "Nova compra") — RD-95: "?" dos itens e observações
-- ============================================================================
-- GAP (PDCA · varredura RD-95 GE-UI): o modal "Nova compra" já tinha "?" em Pagamento e NF, mas os campos
--   da tabela de Itens (Qtd e Preço un.) e o campo Observações ficaram sem o "?". RD-95 pede ajuda em todo
--   campo que o usuário preenche.
-- CORREÇÃO (aditiva, idempotente): três chaves em erp_ajuda_campo; o front (page.tsx) passa a renderizar
--   <AjudaCampo> nos cabeçalhos Qtd/Preço un. (<Th ajuda=...>, cobre os inputs da linha) e no card Observações.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- RD-100: linguagem do usuário, sem nome de sistema de terceiros.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.compra_item_qtd', '/dashboard/commerce/compras', 'Nova compra', 'Quantidade do item',
   'Quanto deste produto está sendo comprado, na unidade mostrada ao lado (un, kg, m etc.).',
   'Multiplica pelo preço unitário para formar o subtotal da linha e o total da compra.',
   '10 (para 10 unidades)', 'Precisa ser maior que zero — o sistema não deixa salvar quantidade zerada ou negativa.', 'gestao_empresarial', 230),

  ('commerce.compras.compra_item_preco', '/dashboard/commerce/compras', 'Nova compra', 'Preço unitário do item',
   'Valor de UMA unidade do produto, conforme a proposta/nota do fornecedor.',
   'Multiplica pela quantidade para formar o subtotal da linha e o total da compra.',
   'R$ 12,50', 'Use o preço por unidade, não o valor total do item (o sistema calcula o subtotal sozinho).', 'gestao_empresarial', 240),

  ('commerce.compras.observacoes', '/dashboard/commerce/compras', 'Nova compra', 'Observações',
   'Anotações livres sobre esta compra (condições combinadas, local de entrega, referência do pedido do fornecedor).',
   'Guarda o contexto da compra para quem for receber, pagar ou conferir depois.',
   'Entregar na obra Centro; frete por conta do fornecedor.', '—', 'gestao_empresarial', 250)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
