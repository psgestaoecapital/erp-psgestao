-- Seed DEMO: cadeia de COMPRAS para a Comércio (GE) — DEMO (company b0700000-...-0004)
-- Tela /dashboard/compras/solicitacoes (PDCA auditor_pdca_2, aud8 92/95). O código
-- das telas de compras está BOM, mas o MÓDULO INTEIRO estava SEM SEED no DEMO GE
-- (erp_compras_solicitacao=0, erp_compras=0, erp_compras_solicitacao_orcamento=0,
-- erp_compras_alcada_config=0). Sem dado, a jornada-núcleo
--   requisição -> cotação (orçamentos) -> alçada/aprovação -> pedido
-- não podia ser demonstrada nem pontuada pelo aud8 (telas renderizavam vazias).
--
-- Este seed cria uma cadeia representativa, ADITIVA, IDEMPOTENTE e SÓ DEMO:
--   * 1 regra de alçada (aprovador principal + substituto, mín. 3 orçamentos);
--   * 3 solicitações em status distintos:
--       - rascunho            (SOL #9001)
--       - aguardando_aprovacao(SOL #9002, 2 itens, 2 orçamentos concorrentes)
--       - aprovada            (SOL #9003, 2 itens, 3 orçamentos → mín. atendido) -> vira PEDIDO
--   * 1 pedido (erp_compras, status 'aberta') gerado da cotação vencedora da SOL #9003.
--
-- Segurança: UUIDs fixos + WHERE EXISTS(company.is_demo) + NOT EXISTS(id) → re-roda
-- sem duplicar e NUNCA toca empresa real. "Quem pede não aprova": solicitante é o
-- usuário de screenshot do DEMO; o aprovador é outro membro (acesso_total). Sem dado
-- pessoal novo (só UUIDs de membros já existentes do DEMO). fn_demo_reset NÃO toca
-- erp_compras* (verificado) → o seed é durável (sobrevive ao reset).
--
-- Code: code-desenvolvedor-3

-- ── 1) Alçada de compras (1 linha por empresa; PK = company_id) ──────────────
INSERT INTO public.erp_compras_alcada_config
  (company_id, aprovador_principal_id, aprovador_substituto_id, min_orcamentos,
   urgencia_categorias, urgencia_produto_ids, atualizado_por)
SELECT
  'b0700000-0000-4000-a000-000000000004'::uuid,
  '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid,  -- aprovador principal (membro acesso_total)
  '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid,  -- aprovador substituto (membro acesso_total)
  3,  -- min_orcamentos aceita apenas 1 ou 3 (CHECK); 3 = disciplina plena de cotação
  '{}'::text[], '{}'::uuid[],
  '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid
WHERE EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.id = 'b0700000-0000-4000-a000-000000000004'::uuid AND c.is_demo
)
ON CONFLICT (company_id) DO NOTHING;

-- ── 2) Solicitações (3 status distintos) ────────────────────────────────────
-- solicitante = usuário de screenshot do DEMO (74cf7dfa); aprovador = 4a3b3c86.
INSERT INTO public.erp_compras_solicitacao
  (id, company_id, numero, solicitante, titulo, justificativa, urgente, status,
   enviada_em, decidido_por, decidido_em, decisao_motivo, criado_em, atualizado_em)
SELECT v.id, 'b0700000-0000-4000-a000-000000000004'::uuid, v.numero,
       '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'::uuid,
       v.titulo, v.justificativa, v.urgente, v.status,
       v.enviada_em, v.decidido_por, v.decidido_em, v.decisao_motivo,
       v.criado_em, v.criado_em
FROM (VALUES
  ('c0a70004-0000-4000-a000-000000000001'::uuid, 9001,
   'Material de escritório — reposição',
   'Reposição de insumos de escritório do trimestre.', false, 'rascunho',
   NULL::timestamptz, NULL::uuid, NULL::timestamptz, NULL::text,
   (now() - interval '1 day')),
  ('c0a70004-0000-4000-a000-000000000002'::uuid, 9002,
   'Cadeiras ergonômicas para o setor comercial',
   'Substituição das cadeiras do comercial por modelo ergonômico (NR-17).', false, 'aguardando_aprovacao',
   (now() - interval '2 days'), NULL::uuid, NULL::timestamptz, NULL::text,
   (now() - interval '3 days')),
  ('c0a70004-0000-4000-a000-000000000003'::uuid, 9003,
   'Notebooks para a equipe de vendas',
   'Aquisição de notebooks para a nova equipe de vendas externas.', false, 'aprovada',
   (now() - interval '6 days'),
   '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid,
   (now() - interval '4 days'),
   'Aprovado — melhor custo/prazo (fornecedor B).',
   (now() - interval '7 days'))
) AS v(id, numero, titulo, justificativa, urgente, status,
       enviada_em, decidido_por, decidido_em, decisao_motivo, criado_em)
WHERE EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.id = 'b0700000-0000-4000-a000-000000000004'::uuid AND c.is_demo
)
AND NOT EXISTS (
  SELECT 1 FROM public.erp_compras_solicitacao s WHERE s.id = v.id
);

-- ── 3) Itens das solicitações ───────────────────────────────────────────────
INSERT INTO public.erp_compras_solicitacao_item
  (id, solicitacao_id, company_id, ordem, descricao, categoria, quantidade, unidade)
SELECT v.id, v.solicitacao_id, 'b0700000-0000-4000-a000-000000000004'::uuid,
       v.ordem, v.descricao, v.categoria, v.quantidade, v.unidade
FROM (VALUES
  -- SOL #9001 (rascunho)
  ('c0a70004-0000-4000-a001-000000000001'::uuid, 'c0a70004-0000-4000-a000-000000000001'::uuid,
   1, 'Papel A4 75g (resma 500 fls)', 'Escritório', 20::numeric, 'resma'),
  -- SOL #9002 (aguardando_aprovacao)
  ('c0a70004-0000-4000-a002-000000000001'::uuid, 'c0a70004-0000-4000-a000-000000000002'::uuid,
   1, 'Cadeira ergonômica presidente (tela mesh)', 'Mobiliário', 6::numeric, 'un'),
  ('c0a70004-0000-4000-a002-000000000002'::uuid, 'c0a70004-0000-4000-a000-000000000002'::uuid,
   2, 'Apoio de pés ergonômico regulável', 'Mobiliário', 6::numeric, 'un'),
  -- SOL #9003 (aprovada)
  ('c0a70004-0000-4000-a003-000000000001'::uuid, 'c0a70004-0000-4000-a000-000000000003'::uuid,
   1, 'Notebook 14" i5 16GB SSD 512GB', 'Informática', 4::numeric, 'un'),
  ('c0a70004-0000-4000-a003-000000000002'::uuid, 'c0a70004-0000-4000-a000-000000000003'::uuid,
   2, 'Mochila para notebook', 'Informática', 4::numeric, 'un')
) AS v(id, solicitacao_id, ordem, descricao, categoria, quantidade, unidade)
WHERE EXISTS (
  SELECT 1 FROM public.erp_compras_solicitacao s WHERE s.id = v.solicitacao_id
)
AND NOT EXISTS (
  SELECT 1 FROM public.erp_compras_solicitacao_item i WHERE i.id = v.id
);

-- ── 4) Orçamentos concorrentes (SOL #9002 e #9003) ──────────────────────────
INSERT INTO public.erp_compras_solicitacao_orcamento
  (id, solicitacao_id, company_id, fornecedor_nome, valor_total, prazo_entrega,
   observacao, criado_por, criado_em)
SELECT v.id, v.solicitacao_id, 'b0700000-0000-4000-a000-000000000004'::uuid,
       v.fornecedor_nome, v.valor_total, v.prazo_entrega, v.observacao,
       '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'::uuid, v.criado_em
FROM (VALUES
  -- SOL #9002
  ('c0a70004-0000-4000-b002-000000000001'::uuid, 'c0a70004-0000-4000-a000-000000000002'::uuid,
   'Office Prime Ltda', 5400.00::numeric, '10 dias úteis', 'Entrega em lote único.',
   (now() - interval '2 days')),
  ('c0a70004-0000-4000-b002-000000000002'::uuid, 'c0a70004-0000-4000-a000-000000000002'::uuid,
   'MoveMais Comercial', 4980.00::numeric, '15 dias úteis', 'Melhor preço; prazo maior.',
   (now() - interval '2 days')),
  -- SOL #9003 (vencedor = fornecedor B: InfoVip)
  ('c0a70004-0000-4000-b003-000000000001'::uuid, 'c0a70004-0000-4000-a000-000000000003'::uuid,
   'TecnoSul Distribuidora', 15600.00::numeric, '7 dias úteis', 'Garantia 24 meses.',
   (now() - interval '5 days')),
  ('c0a70004-0000-4000-b003-000000000002'::uuid, 'c0a70004-0000-4000-a000-000000000003'::uuid,
   'InfoVip Suprimentos', 14890.00::numeric, '5 dias úteis', 'Escolhido: melhor custo/prazo.',
   (now() - interval '5 days')),
  ('c0a70004-0000-4000-b003-000000000003'::uuid, 'c0a70004-0000-4000-a000-000000000003'::uuid,
   'CompuMax Atacado', 15200.00::numeric, '6 dias úteis', 'Atende, mas preço acima do vencedor.',
   (now() - interval '5 days'))
) AS v(id, solicitacao_id, fornecedor_nome, valor_total, prazo_entrega, observacao, criado_em)
WHERE EXISTS (
  SELECT 1 FROM public.erp_compras_solicitacao s WHERE s.id = v.solicitacao_id
)
AND NOT EXISTS (
  SELECT 1 FROM public.erp_compras_solicitacao_orcamento o WHERE o.id = v.id
);

-- ── 5) Pedido (erp_compras) gerado da cotação vencedora da SOL #9003 ─────────
INSERT INTO public.erp_compras
  (id, company_id, numero, cotacao_origem_id, fornecedor_nome, data_pedido,
   data_prevista, status, condicao_pagamento, parcelas, subtotal, total,
   observacoes, created_by, aprovado_por, aprovado_em, aprovacao_motivo)
SELECT
  'c0a70004-0000-4000-c000-000000000003'::uuid,
  'b0700000-0000-4000-a000-000000000004'::uuid,
  'PC-9003',
  'c0a70004-0000-4000-a000-000000000003'::uuid,   -- elo cotação -> pedido (sem FK; rastreabilidade)
  'InfoVip Suprimentos',
  (now() - interval '3 days')::date,
  (now() + interval '2 days')::date,
  'aberta',
  '30 dias', 1,
  14890.00, 14890.00,
  'Pedido gerado a partir da solicitação #9003 (cotação vencedora InfoVip Suprimentos).',
  '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'::uuid,
  '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid,
  (now() - interval '4 days'),
  'Aprovado — melhor custo/prazo (fornecedor B).'
WHERE EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.id = 'b0700000-0000-4000-a000-000000000004'::uuid AND c.is_demo
)
AND NOT EXISTS (
  SELECT 1 FROM public.erp_compras p WHERE p.id = 'c0a70004-0000-4000-c000-000000000003'::uuid
);

-- ── 6) Itens do pedido ──────────────────────────────────────────────────────
INSERT INTO public.erp_compras_itens
  (id, compra_id, company_id, ordem, produto_nome, unidade, quantidade,
   preco_unitario, subtotal)
SELECT v.id, 'c0a70004-0000-4000-c000-000000000003'::uuid,
       'b0700000-0000-4000-a000-000000000004'::uuid,
       v.ordem, v.produto_nome, v.unidade, v.quantidade, v.preco_unitario, v.subtotal
FROM (VALUES
  ('c0a70004-0000-4000-d003-000000000001'::uuid, 1, 'Notebook 14" i5 16GB SSD 512GB', 'un', 4::numeric, 3400.00::numeric, 13600.00::numeric),
  ('c0a70004-0000-4000-d003-000000000002'::uuid, 2, 'Mochila para notebook',          'un', 4::numeric,  322.50::numeric,  1290.00::numeric)
) AS v(id, ordem, produto_nome, unidade, quantidade, preco_unitario, subtotal)
WHERE EXISTS (
  SELECT 1 FROM public.erp_compras p WHERE p.id = 'c0a70004-0000-4000-c000-000000000003'::uuid
)
AND NOT EXISTS (
  SELECT 1 FROM public.erp_compras_itens i WHERE i.id = v.id
);
