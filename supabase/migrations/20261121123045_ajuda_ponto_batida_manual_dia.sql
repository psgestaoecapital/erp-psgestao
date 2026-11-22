-- RD-95 (CEO 08/10): "?" em TODO campo/ação. Auditoria PDCA (19/11) em
-- /dashboard/industrial/ponto apontou que a empresa SEM integração de relógio
-- não conseguia registrar a BATIDA de um dia (só o total de horas por período).
-- O lançamento manual ganhou o modo "Batida do dia" (data + entrada/saída → horas),
-- reusando fn_ponto_horas_manual_lancar (periodo_inicio = periodo_fim = o dia).
-- Esta migração popula o texto de ajuda dos 5 campos novos desse modo, no mesmo
-- padrão das demais chaves ponto.manual.* da tela (vertical industrial).
-- Aditiva e idempotente (ON CONFLICT (chave) DO UPDATE); só catálogo de ajuda,
-- não toca dado de cliente nem estrutura.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ponto.manual.modo',
   '/dashboard/industrial/ponto', 'Lançamento manual', 'Como lançar (batida do dia ou total por período)',
   'Escolha "Batida do dia" para registrar a jornada de UM dia pela hora de entrada e de saída, ou "Total por período" para informar o total de horas de um intervalo de datas.',
   'Deixa a empresa sem relógio integrado operar o ponto à mão, do jeito que fizer sentido: batida diária quando controla por dia, total quando fecha por período.',
   'Controla por dia? Use "Batida do dia" e informe 08:00 / 17:00. Fecha o mês de uma vez? Use "Total por período" e informe 176 horas.',
   'Lançar o total do mês no modo "Batida do dia": esse modo é de UM dia só; para o mês inteiro use "Total por período".',
   'industrial', 50),

  ('ponto.manual.dia',
   '/dashboard/industrial/ponto', 'Lançamento manual', 'Dia da batida',
   'A data do dia trabalhado que você está registrando (um dia por lançamento).',
   'Define a que dia pertence a jornada lançada, alimentando o fechamento e o Painel por dia desse colaborador.',
   'Ex.: 18/11/2026 para a jornada trabalhada nessa terça-feira.',
   'Colocar uma data futura ou o mês inteiro: a batida é de um único dia já trabalhado.',
   'industrial', 51),

  ('ponto.manual.entrada',
   '/dashboard/industrial/ponto', 'Lançamento manual', 'Hora de entrada',
   'A hora em que o colaborador começou a jornada, no formato HH:MM (24h).',
   'É o início da jornada; junto com a saída e o intervalo, o sistema calcula as horas trabalhadas no dia.',
   'Ex.: 08:00 para quem entrou às oito da manhã.',
   'Usar formato 12h (8 ou 8h): informe 08:00. A saída precisa ser depois da entrada, no mesmo dia.',
   'industrial', 52),

  ('ponto.manual.saida',
   '/dashboard/industrial/ponto', 'Lançamento manual', 'Hora de saída',
   'A hora em que o colaborador terminou a jornada, no formato HH:MM (24h).',
   'É o fim da jornada; o sistema faz saída − entrada − intervalo para achar as horas do dia.',
   'Ex.: 17:00 para quem saiu às cinco da tarde.',
   'Informar saída igual ou anterior à entrada: a jornada precisa terminar depois de começar (mesmo dia).',
   'industrial', 53),

  ('ponto.manual.intervalo',
   '/dashboard/industrial/ponto', 'Lançamento manual', 'Intervalo (minutos)',
   'Quantos minutos de intervalo (almoço/descanso) descontar da jornada. Deixe em branco ou 0 se não houve intervalo.',
   'Desconta a pausa do cálculo para as horas do dia saírem líquidas (só o tempo efetivamente trabalhado).',
   'Ex.: 60 para uma hora de almoço — 08:00 às 17:00 com 60 min vira 8,0h.',
   'Digitar em horas: o campo é em MINUTOS. Uma hora de almoço é 60, não 1.',
   'industrial', 54)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem,
  versao = public.erp_ajuda_campo.versao + 1, atualizado_em = now();
