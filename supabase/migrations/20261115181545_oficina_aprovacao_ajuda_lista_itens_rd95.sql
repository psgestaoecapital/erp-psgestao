-- Oficina · Aprovação/Orçamento (/dashboard/oficina/aprovacao) — RD-95: "?" na lista de laudos e na ação de orçar
-- ============================================================================
-- GAP (PDCA auditor, nota parcial): a tela tinha "?" só na Busca. Faltava ajuda na LISTA de laudos
--   (o que cada cartão mostra e como escolher) e na AÇÃO DE ORÇAR item a item (aprovar + precificar).
--   RD-95: todo indicador/ação precisa do "?" — tela com ação sem ajuda não é entregue.
-- CORREÇÃO (aditiva, idempotente): duas chaves em erp_ajuda_campo; o front (page.tsx) passa a
--   renderizar <AjudaCampo chave="..."> no cabeçalho da lista e no título da seção de itens.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- RD-100: linguagem do cliente, sem nome de sistema de terceiro.
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('oficina.aprovacao.lista', '/dashboard/oficina/aprovacao', 'Oficina', 'Laudos para orçar',
   'Não é um campo de digitar: é a lista dos laudos (diagnósticos) prontos para virar orçamento. Toque num cartão para abrir e montar o orçamento.',
   'Cada cartão mostra a placa/identificação, o número da OS, o veículo e o cliente, para você escolher qual laudo vai orçar.',
   'Tocar em "ABC1D23 · OS 00123 · Fiat Strada · João" para começar o orçamento dessa OS.',
   'Não achar a OS porque o orçamento já foi aprovado (ela sai da lista) ou porque a Busca acima ainda está preenchida e filtrando.',
   'oficina', 2),

  ('oficina.aprovacao.itens', '/dashboard/oficina/aprovacao', 'Oficina', 'Itens do orçamento',
   'Para cada item marque "Fazer" (aprovar) ou "Não" e informe o valor (R$) a cobrar; nas peças, informe também o custo para ver a margem.',
   'Monta o orçamento item a item — só os itens marcados "Fazer" e com valor entram no total que o cliente autoriza.',
   'Troca de pastilhas · Fazer · R$ 180,00 (custo R$ 90 → margem 50%).',
   'Aprovar o item e deixar o valor em branco: ele fica fora do total e a OS não fatura certo.',
   'oficina', 3)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
