-- Commerce · Nova compra (/dashboard/commerce/compras, modal "Nova compra") — RD-95: "?" do campo Observações
-- ============================================================================
-- GAP (PDCA · varredura RD-95 GE-UI): o modal "Nova compra" já tinha "?" em Pagamento, NF, Fornecedor e nos
--   itens (Qtd/Preço un., entregues pela #5165). O card "Observações" ficou sem o "?". RD-95 pede ajuda em
--   todo campo que o usuário preenche.
-- ESCOPO (revisão #5167): Qtd e Preço un. já têm chave/"?" em produção pela #5165 — esta migration entrega
--   SOMENTE a chave nova do campo Observações (sem reescrever as da #5165; fonte única, RD-52).
-- CORREÇÃO (aditiva, idempotente): uma chave em erp_ajuda_campo; o front (page.tsx) renderiza <AjudaCampo>
--   no cabeçalho do card Observações.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- RD-100: linguagem do usuário, sem nome de sistema de terceiros.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.observacoes', '/dashboard/commerce/compras', 'Nova compra', 'Observações',
   'Anotações livres sobre esta compra (condições combinadas, local de entrega, referência do pedido do fornecedor).',
   'Guarda o contexto da compra para quem for receber, pagar ou conferir depois.',
   'Entregar na obra Centro; frete por conta do fornecedor.', '—', 'gestao_empresarial', 250)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
