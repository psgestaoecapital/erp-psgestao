-- RD-95 (CEO 08/10): "?" na tela Painel do gestor · Tempo (P&M) · /dashboard/pm/painel-gestor.
-- O auditor PDCA pediu fechar RD-95; a tela (só leitura, mostra horas, nunca custo) não tinha nenhum "?".
-- Esta PR cadastra a ajuda do contexto da tela, do filtro de janela (Hoje/7/30 dias) e dos 3 indicadores
-- (cobertura de apontamento, jobs sem horas, alerta de 80% do estimado). Aditivo: só texto em erp_ajuda_campo.
-- Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/painel-gestor', 'pm', 'publicado'
FROM (VALUES
 ('pm.painel_gestor.tela', 'Painel do gestor · Visão geral', 'Painel do gestor · Tempo',
  'Painel só de leitura para o gestor: quem está apontando horas, jobs sem horas e jobs perto de estourar o estimado. Mostra horas, nunca custo.',
  'Dá ao gestor a visão rápida da disciplina de apontamento e dos riscos de tempo, para cobrar a equipe e agir antes do estouro.',
  'Abrir no início do dia para ver quem ainda não apontou e quais jobs estão em 80% do estimado.',
  'Procurar valores em R$ aqui: este painel é só de horas; custo fica nas telas financeiras.',
  1),
 ('pm.painel_gestor.filtro_janela', 'Painel do gestor · Filtro', 'Janela (Hoje / 7 / 30 dias)',
  'Escolha o período da cobertura de apontamento: Hoje, últimos 7 dias ou últimos 30 dias.',
  'Muda a janela sobre a qual a cobertura de apontamento da equipe é calculada.',
  '"7 dias" mostra quem apontou (e quanto) na última semana.',
  'Comparar cobertura de janelas diferentes sem notar o filtro: 0 h em "Hoje" não é o mesmo que 0 h em "30 dias".',
  2),
 ('pm.painel_gestor.cobertura', 'Painel do gestor · Indicadores', 'Cobertura de apontamento',
  'Lista a equipe e, na janela escolhida, quem apontou (horas e dias) e quem está sem apontamento.',
  'Mede a disciplina de apontamento: destaca em vermelho quem não lançou horas no período.',
  '"3 de 5 pessoas" = duas ainda não apontaram na janela.',
  'Cobrar quem está "sem apontamento" sem conferir a janela: troque para 7/30 dias antes de concluir.',
  3),
 ('pm.painel_gestor.sem_horas', 'Painel do gestor · Indicadores', 'Jobs em andamento sem horas',
  'Lista jobs em andamento que ainda não têm nenhuma hora apontada. Clique no job para abrir no painel de jobs.',
  'Aponta trabalho em curso sem registro de tempo — risco de margem e de apontamento esquecido.',
  'Um job "em produção" há dias sem horas aparece aqui com o responsável.',
  'Ignorar a lista: job sem horas distorce o realizado e a margem quando fechar.',
  4),
 ('pm.painel_gestor.alerta_80', 'Painel do gestor · Indicadores', 'Alerta de 80% do estimado',
  'Lista jobs cujas horas realizadas já chegaram a 80% (ou passaram) das horas estimadas.',
  'Antecipa o estouro de horas: permite renegociar escopo/prazo antes de ultrapassar o estimado.',
  '"92% · 46/50 h" = o job está perto do teto; em vermelho já estourou.',
  'Esperar o job estourar para agir: o alerta existe justamente para intervir nos 80%.',
  5)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
