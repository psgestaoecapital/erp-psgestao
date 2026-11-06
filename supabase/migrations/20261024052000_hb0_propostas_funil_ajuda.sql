-- HB0 (auditor F15 em /dashboard/projetos/propostas): a tela ganha indicadores, funil por situação e a coluna de validade.
-- Só acrescenta os textos do "?" (RD-95) das áreas novas. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.em_aberto', 'Propostas em aberto', 'Nada a preencher: conta as propostas em rascunho, enviadas ou visualizadas e soma o valor delas.', 'Mostra quanto dinheiro ainda depende de resposta do cliente.', '3 propostas · R$ 180.000,00 esperando o cliente.', 'Contar como venda: em aberto ainda não é pedido.', 12),
 ('projetos.propostas.aprovadas', 'Aprovadas / viraram pedido', 'Nada a preencher: conta as propostas aprovadas pelo cliente e as que já viraram pedido.', 'Mostra o que você já ganhou com as propostas da lista.', '4 propostas · R$ 320.000,00 aprovadas.', 'Achar que aprovada já gerou faturamento: o pedido nasce em "Virou pedido".', 13),
 ('projetos.propostas.taxa_aprovacao', 'Taxa de aprovação', 'Nada a preencher: aprovadas ÷ (aprovadas + recusadas + expiradas). Propostas sem resposta não entram na conta.', 'Mede quantas propostas viram negócio quando o cliente decide.', '4 aprovadas e 1 recusada = 80%.', 'Comparar com propostas ainda sem resposta: elas não contam até o cliente decidir.', 14),
 ('projetos.propostas.a_vencer', 'Vencem em 7 dias', 'Nada a preencher: propostas em aberto cuja validade termina nos próximos 7 dias.', 'Avisa quem cobrar agora, antes de o preço perder a validade.', '2 propostas vencem esta semana: ligue para o cliente.', 'Deixar vencer e mandar o mesmo preço: revise o custo antes de renovar.', 15),
 ('projetos.propostas.funil', 'Situações da proposta', 'Toque numa situação para ver só as propostas nela; toque de novo para ver todas.', 'Mostra quantas propostas e quanto valor há em cada etapa, do rascunho ao pedido.', 'Enviado · 1 · R$ 45.000,00.', 'Esquecer o filtro ligado: a situação marcada fica destacada.', 16),
 ('projetos.propostas.validade', 'Validade da proposta', 'Nada a preencher: data até quando o preço vale. Em aberto e perto de vencer fica em destaque.', 'Mostra quais propostas precisam de retorno do cliente logo.', '30/10/2026 · 6 dia(s).', 'Renovar sem rever o custo: o preço pode ter mudado.', 17)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
