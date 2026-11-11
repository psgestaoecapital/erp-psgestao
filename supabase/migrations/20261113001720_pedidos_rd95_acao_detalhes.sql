-- Operação · Pedidos de Venda (/dashboard/pedidos) — RD-95: "?" (AjudaCampo) na ação "Detalhes →" da lista.
-- A PR #4452 cobriu KPIs, busca, filtro, colunas e as demais ações, mas o botão "Detalhes →" de cada linha
-- (a porta de entrada do pedido) ficou sem o "?". O auditor reabriu o gap de RD-95 da tela. Aditiva: só insere
-- UMA linha de ajuda, ON CONFLICT (chave) DO NOTHING — não altera texto já publicado e não toca dado de cliente.
-- Texto em linguagem do usuário, 4 blocos fixos (o que mostra · para que serve · exemplo · erro comum).
-- Faixa do agente jordana-code (segundos :20). Lookup por rota em fn_ajuda_campo_listar.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('pedidos.acao_detalhes', 'Ações', 'Detalhes',
 'Abre o pedido completo: itens, total por serviços e produtos, troca de status, edição de itens e geração de contas a receber.',
 'É a porta de entrada para tudo que se faz no pedido depois de criado — da lista você só visualiza; aqui você age.',
 'Clicar em "Detalhes →" para editar os itens ou gerar os títulos do pedido.',
 'Procurar editar ou faturar o pedido direto na lista: todas as ações ficam dentro de "Detalhes".',
 145, '/dashboard/pedidos', 'ge', 'publicado')
ON CONFLICT (chave) DO NOTHING;
