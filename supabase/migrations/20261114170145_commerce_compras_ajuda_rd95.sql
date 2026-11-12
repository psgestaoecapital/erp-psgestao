-- Commerce · Compras & Cotações (/dashboard/commerce/compras) — RD-95: cadastra as chaves de ajuda ("?")
-- ============================================================================
-- GAP (PDCA aud8 12/11, nota 88/95): a tela tinha ZERO "?" (AjudaCampo) — abas Cotações/Pedidos de
--   Compra, busca, filtro de status e botões Nova cotação/Nova compra sem ajuda. Tela com campo/ação
--   sem "?" não é entregue.
-- CORREÇÃO (aditiva, idempotente): seis chaves em erp_ajuda_campo para os controles do topo da tela;
--   o front (page.tsx) passa a renderizar <AjudaCampo chave="..."> nesses pontos.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.compras.aba_cotacoes', '/dashboard/commerce/compras', 'Compras & Cotações', 'Aba Cotações',
   'Mostra as cotações: o pedido de propostas a vários fornecedores antes de comprar.',
   'Separa a fase de cotar (comparar preços de fornecedores) da fase de comprar (pedido já decidido).',
   'Cotação de materiais de drywall para 3 fornecedores', '—', 'gestao_empresarial', 10),

  ('commerce.compras.aba_pedidos', '/dashboard/commerce/compras', 'Compras & Cotações', 'Aba Pedidos de Compra',
   'Mostra os pedidos de compra: a compra já aprovada, com fornecedor e valor definidos.',
   'Acompanha a compra do envio ao recebimento (atualiza estoque) e à geração do financeiro.',
   'Pedido de compra nº 00123 — Fornecedor Alfa', '—', 'gestao_empresarial', 20),

  ('commerce.compras.nova_cotacao', '/dashboard/commerce/compras', 'Compras & Cotações', 'Nova Cotação',
   'Abre o formulário para criar uma cotação e pedir propostas a vários fornecedores.',
   'Inicia o comparativo de preços antes de decidir a compra; ao aprovar, vira pedido de compra.',
   'Clicar em Nova Cotação e listar os itens a cotar', 'Precisa selecionar uma empresa específica no topo antes de criar.', 'gestao_empresarial', 30),

  ('commerce.compras.nova_compra', '/dashboard/commerce/compras', 'Compras & Cotações', 'Nova compra',
   'Abre o formulário para lançar uma compra direta, sem passar por cotação.',
   'Registra a compra já decidida (fornecedor e itens conhecidos) para controlar entrega, estoque e financeiro.',
   'Compra direta de um fornecedor habitual', 'Precisa selecionar uma empresa específica no topo antes de criar.', 'gestao_empresarial', 40),

  ('commerce.compras.busca', '/dashboard/commerce/compras', 'Compras & Cotações', 'Busca',
   'Digite parte do número, descrição, solicitante, fornecedor ou NF para filtrar a lista.',
   'Encontra rápido uma cotação ou um pedido específico sem rolar a lista inteira.',
   'Digitar "drywall" ou o número "00123"', 'A busca é só na aba atual (Cotações ou Pedidos) — troque de aba se não achar.', 'gestao_empresarial', 50),

  ('commerce.compras.filtro_status', '/dashboard/commerce/compras', 'Compras & Cotações', 'Filtro de status',
   'Escolha um status para ver só as cotações/pedidos naquela situação (ou "Todos os status").',
   'Foca o trabalho — por exemplo, só as cotações aguardando resposta ou os pedidos a receber.',
   'Filtrar por "Aguardando entrega"', 'Esqueceu o filtro ligado e achou que a lista estava vazia — volte para "Todos os status".', 'gestao_empresarial', 60)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
