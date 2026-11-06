-- P&M · /dashboard/pm/comercial (Hub Comercial) — RD-95: "?" nos 5 indicadores e no Funil de leads.
-- Gap do auditor aud8claudeps (28/10, nota 70): "Adicionar ? (RD-95) nos indicadores". A tela não tinha nenhuma
-- ajuda. A "?" da Conversão explica, honestamente, o denominador (aprovadas ÷ TODAS as propostas, inclusive rascunhos)
-- — por isso o número aparece baixo quando há muitos rascunhos (RD-97: explicar, não esconder).
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.comercial.kpi_pipeline', 'Comercial', 'Pipeline (em aberto)',
  'Nada a preencher: conta os leads em etapas NÃO fechadas (fora de ganho/perdido) e soma o valor estimado deles.',
  'Mostra o volume de oportunidades vivas — quantos leads e quanto valor ainda estão em jogo.',
  '18 leads em aberto · R$ 240.000 estimados.',
  'Somar leads já ganhos/perdidos: só entram as etapas abertas do funil.', 10, '/dashboard/pm/comercial'),
 ('pm.comercial.kpi_propostas', 'Comercial', 'Propostas abertas',
  'Nada a preencher: conta as propostas em rascunho ou enviadas (ainda sem decisão); o subtítulo mostra quantas já foram aprovadas.',
  'Mostra quanto está pendente de resposta do cliente — o que depende de follow-up.',
  '5 abertas · 6 aprovadas.',
  'Confundir aberta com aprovada: aprovada já saiu do aberto e vira contrato/comissão.', 20, '/dashboard/pm/comercial'),
 ('pm.comercial.kpi_conversao', 'Comercial', 'Conversão',
  'Nada a preencher: é propostas APROVADAS ÷ TOTAL de propostas (inclui rascunhos), em %.',
  'Mostra a taxa de fechamento das propostas. Como os rascunhos entram no total, muitos rascunhos derrubam a %: um número baixo pode ser muito rascunho, não necessariamente proposta perdida.',
  '6 aprovadas de 719 propostas (a maioria rascunho) = 1%.',
  'Ler a % como perda real sem olhar quantos são rascunho: limpe/arquive os rascunhos para a taxa refletir o funil de verdade.', 30, '/dashboard/pm/comercial'),
 ('pm.comercial.kpi_comissao', 'Comercial', 'Comissão a pagar',
  'Nada a preencher: soma as comissões com status "a pagar"; o subtítulo soma as "previstas".',
  'Mostra o compromisso de comissão já devido (a pagar) e o que ainda está previsto — base do caixa do comercial.',
  'R$ 3.200 a pagar · R$ 5.000 previstos.',
  'Tratar previsto como devido: previsto ainda depende de o negócio fechar/faturar.', 40, '/dashboard/pm/comercial'),
 ('pm.comercial.kpi_contratos', 'Comercial', 'Novos contratos (mês)',
  'Nada a preencher: conta os contratos de agência (tipo agencia_pm) criados no mês corrente e soma o valor mensal (fee).',
  'Mostra o quanto de receita recorrente nova entrou no mês — o crescimento do MRR da agência.',
  '2 novos contratos · R$ 7.000/mês.',
  'Confundir com total de contratos: aqui só entram os criados neste mês.', 50, '/dashboard/pm/comercial'),
 ('pm.comercial.funil', 'Comercial', 'Funil de leads',
  'Nada a preencher: mostra quantos leads estão em cada etapa do funil configurado da empresa (funil_etapa).',
  'Dá a leitura do funil de ponta a ponta — onde os leads estão parados e onde afunila. As etapas são as reais da empresa, não uma lista fixa.',
  'Novo atendimento 12 · Reunião 4 · Proposta 2 · Ganho 1.',
  'Estranhar uma etapa zerada: pode ser etapa sem lead no momento, não erro — compare com o quadro de Leads.', 60, '/dashboard/pm/comercial')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
