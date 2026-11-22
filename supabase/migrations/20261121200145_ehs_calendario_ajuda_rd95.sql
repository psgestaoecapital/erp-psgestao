-- RD-95 (/dashboard/ehs/calendario · Calendário Legal SST): a tela não tinha
-- nenhuma chave de ajuda (aud8). Cadastra os textos de ajuda dos 4 KPIs do topo
-- (Ativas, Vencem 7d, Vencidas, Exposição) e um "?" para a barra de filtros
-- (risco: crítico/alto/médio · status: pendentes/vencidas/todas). O page.tsx passa
-- a renderizar <AjudaCampo> nos KPIs (prop `ajuda` do KpiCard) e na barra de filtros.
-- Só metadados de ajuda (erp_ajuda_campo); não toca dado de cliente, RLS nem cálculo.
-- Aditiva/idempotente. Faixa de segundos :45 (desenvolvedor_4_g).
-- Code: desenvolvedor_4_g
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Calendário Legal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/ehs/calendario', 'compliance', 'publicado'
FROM (VALUES
 ('ehs.calendario.kpi_ativas', 'Ativas',
  'Não preenche: é um indicador. Conta as tarefas legais ainda abertas (pendentes ou em andamento) da(s) empresa(s) selecionada(s).',
  'Mostra o tamanho da fila de obrigações a cumprir — quanto ainda está em aberto no calendário legal.',
  'Se há 12 obrigações abertas, o KPI mostra 12; conclua ou trate cada uma para o número cair.',
  'Confundir "Ativas" com "Vencidas": ativa é o que está aberto; vencida é a que passou do prazo.', 1),
 ('ehs.calendario.kpi_vencem_7d', 'Vencem em 7 dias',
  'Não preenche: é um indicador. Conta as tarefas cujo prazo vence nos próximos 7 dias.',
  'É o alerta de curto prazo — o que precisa de ação AGORA para não virar multa.',
  'KPI "3" = três obrigações vencem nesta semana; priorize-as na lista abaixo.',
  'Deixar para depois: em 7 dias elas migram para "Vencidas" e passam a expor a multa.', 2),
 ('ehs.calendario.kpi_vencidas', 'Vencidas',
  'Não preenche: é um indicador. Conta as tarefas que já passaram do prazo; o valor menor (hint) é a multa já incorrida.',
  'Mede o passivo em atraso — quanto já está fora do prazo e o risco financeiro associado.',
  'KPI "2" com R$ 1.500 abaixo = duas obrigações vencidas com R$ 1.500 de multa atual.',
  'Ignorar: a multa de vencidas tende a crescer; trate antes de acumular.', 3),
 ('ehs.calendario.kpi_exposicao', 'Exposição',
  'Não preenche: é um indicador em R$. Soma as multas POTENCIAIS de todas as obrigações em aberto (não só as vencidas).',
  'Dá a dimensão do risco financeiro total do calendário legal se nada for feito.',
  'R$ 48.000 = soma das multas potenciais de todas as tarefas ativas; cumprir as obrigações reduz esse número.',
  'Ler como valor já devido: é potencial (se descumprir), não uma dívida certa — o de vencidas é o já incorrido.', 4),
 ('ehs.calendario.filtros', 'Filtros',
  'Escolha chips para afunilar a lista: por risco (crítico, alto, médio) e por status (pendentes, vencidas, todas).',
  'Foca a lista no que importa agora — por exemplo, só as críticas vencidas.',
  'Clique "Crítico" + "Vencidas" para ver só as obrigações críticas em atraso.',
  'Esquecer um chip ligado e achar que faltam tarefas: os filtros se somam; use "Todos riscos"/"Todas" para limpar.', 5)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
