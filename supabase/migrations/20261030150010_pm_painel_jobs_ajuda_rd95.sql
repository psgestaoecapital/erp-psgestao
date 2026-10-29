-- P&M · /dashboard/pm/painel-jobs — RD-95: "?" nos 6 indicadores (KPIs) do topo. A tela não tinha nenhum "?".
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.painel_jobs.ind_total', 'Painel de Jobs', 'Total de jobs',
  'Nada a preencher: conta os jobs que passam no filtro atual (jobs encerrados-legado ficam de fora).',
  'É a base de todos os outros indicadores — o tamanho da carteira de jobs que você está olhando.',
  '48 jobs no filtro do mês.',
  'Estranhar o número cair ao filtrar: cada filtro reduz o total; limpe os filtros para ver tudo.', 10, '/dashboard/pm/painel-jobs'),
 ('pm.painel_jobs.ind_alteracoes', 'Painel de Jobs', 'Alterações',
  'Nada a preencher: soma as rodadas de ajuste (retrabalho) dos jobs no filtro.',
  'Mede quanto retrabalho a operação teve — muitas alterações indicam briefing ou aprovação frágil.',
  '32 alterações · média 0,7 por job.',
  'Ler alteração como erro do time: pode ser mudança pedida pelo cliente — veja os motivos no gráfico.', 20, '/dashboard/pm/painel-jobs'),
 ('pm.painel_jobs.ind_realizado_estimado', 'Painel de Jobs', 'Realizado / estimado',
  'Nada a preencher: compara as horas apontadas (realizadas) com as horas estimadas dos jobs do filtro.',
  'Mostra se a agência está gastando mais ou menos horas do que planejou — acima de 100% é estouro de esforço.',
  '92% · 245 h de 266 h.',
  'Esperar 100% com poucos apontamentos: se o time ainda não lançou horas, o número fica baixo por falta de registro, não por folga.', 30, '/dashboard/pm/painel-jobs'),
 ('pm.painel_jobs.ind_dias_conclusao', 'Painel de Jobs', 'Dias da conclusão',
  'Nada a preencher: média de dias entre o início (ou criação) e a entrega, só dos jobs concluídos.',
  'Diz quanto tempo um job leva, em média, para ficar pronto — base para prometer prazo ao cliente.',
  '9 dias de média até entregar.',
  'Comparar com jobs ainda em aberto: só entram os concluídos; job em andamento não tem data de entrega.', 40, '/dashboard/pm/painel-jobs'),
 ('pm.painel_jobs.ind_dias_atraso', 'Painel de Jobs', 'Dias de atraso',
  'Nada a preencher: média de dias de atraso dos jobs ainda abertos cujo prazo já passou.',
  'Aponta o tamanho do problema de prazo hoje — quanto, em média, os jobs vencidos estão estourados.',
  '3 dias de atraso médio.',
  'Achar que inclui todos os jobs: entram só os abertos e vencidos; os entregues não contam aqui.', 50, '/dashboard/pm/painel-jobs'),
 ('pm.painel_jobs.ind_media_alteracoes', 'Painel de Jobs', 'Média de alterações',
  'Nada a preencher: alterações divididas pelo total de jobs do filtro.',
  'Normaliza o retrabalho pelo tamanho da carteira, para comparar períodos com volumes diferentes.',
  '0,7 alteração por job.',
  'Ler o valor isolado: compare com outros períodos — sozinho ele diz pouco.', 60, '/dashboard/pm/painel-jobs')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
ON CONFLICT (chave) DO NOTHING;
