-- RD-95 (CEO 08/10): "?" em todo campo. Cadastro dos textos de ajuda do formulário
-- "Registrar horas" (timesheet) do Workspace da Agência (/dashboard/producao).
-- Aditiva e idempotente (ON CONFLICT DO NOTHING): só insere chaves novas, não altera texto existente.
-- PDCA /dashboard/producao · gap4 cobertura-ajuda. Code: desenvolvedor_4_g.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
  ('pm.timesheet.job', 'Timesheet', 'Job',
   'Escolha o job em que você trabalhou. A lista traz só os jobs em andamento (não aparecem os concluídos, publicados ou cancelados).',
   'Liga as horas apontadas ao job certo, somando o esforço real e alimentando a margem (receita × custo das horas) e o KPI "Horas no mês".',
   'Post Dia das Crianças — carrossel 3 cards.',
   'Apontar as horas no job errado: o custo entra na margem do job que não recebeu o trabalho; confira o título antes de registrar.',
   10, '/dashboard/producao'),
  ('pm.timesheet.data', 'Timesheet', 'Data',
   'O dia em que o trabalho foi feito. Já vem preenchido com hoje; troque se estiver lançando horas de um dia anterior.',
   'Define em que mês as horas entram no KPI "Horas no mês" e nos relatórios por período.',
   '01/11/2026 para horas trabalhadas hoje.',
   'Deixar a data de hoje ao lançar horas antigas: elas caem no mês errado e distorcem o fechamento do período.',
   20, '/dashboard/producao'),
  ('pm.timesheet.horas', 'Timesheet', 'Horas',
   'Quantas horas você gastou nesse job no dia, em número (aceita fração: 1,5 = uma hora e meia).',
   'É a base do custo do job e das horas realizadas; compara-se com as horas estimadas para mostrar estouro de esforço.',
   '2.5 para duas horas e meia.',
   'Lançar minutos como se fossem horas (digitar 30 em vez de 0,5): o custo fica 60× maior.',
   30, '/dashboard/producao'),
  ('pm.timesheet.atividade', 'Timesheet', 'Atividade',
   'O tipo de trabalho da hora apontada: Criação, Atendimento, Produção, Edição, Revisão, Reunião ou Planejamento. Opcional.',
   'Mostra em que etapas a equipe gasta o tempo, ajudando a enxergar onde o processo consome mais horas.',
   'Edição para o tempo gasto finalizando um vídeo.',
   'Classificar tudo como "Produção": perde-se a visão de quanto tempo vai para reunião, revisão ou atendimento.',
   40, '/dashboard/producao'),
  ('pm.timesheet.descricao', 'Timesheet', 'Descrição',
   'Em poucas palavras, o que foi feito nessas horas. Opcional, mas ajuda quem revisa.',
   'Dá contexto ao apontamento para conferência e para o cliente entender o que gerou o esforço.',
   'Ajustes de cor e corte final do reels.',
   'Deixar genérico ("trabalho no job"): não dá para conferir depois o que realmente foi feito.',
   50, '/dashboard/producao')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
