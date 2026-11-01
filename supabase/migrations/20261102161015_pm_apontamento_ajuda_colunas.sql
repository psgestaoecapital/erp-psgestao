-- RD-95 (CEO 08/10): "?" (AjudaCampo) em TODA coluna da tabela de /dashboard/pm/apontamento-horas.
-- A tela já tinha "?" em campos do formulário, KPIs e no toggle de ruído; faltavam as COLUNAS da tabela
-- (Data, Job, Etapa, Horas, Custo, Descrição). Esta migration cadastra as chaves de ajuda dessas colunas
-- em erp_ajuda_campo (fonte única lida por fn_ajuda_campo_listar). Aditiva, idempotente (chave é única).
-- Code: dev7claudeps

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
VALUES
  ('pm.apontamento.col_data', '/dashboard/pm/apontamento-horas', 'Apontamento', 'pm',
   'Data',
   'Coluna só de leitura: o dia em que as horas foram lançadas (vem do cronômetro ou do lançamento manual).',
   'Mostra quando cada apontamento aconteceu, para você conferir a sequência do trabalho e achar lançamentos fora de ordem.',
   '02/11/2026',
   'Esperar editar a data aqui: para corrigir, exclua o lançamento e lance de novo na data certa.',
   50, 'publicado'),

  ('pm.apontamento.col_job', '/dashboard/pm/apontamento-horas', 'Apontamento', 'pm',
   'Job',
   'Coluna só de leitura: o job (trabalho/cliente) a que as horas foram atribuídas.',
   'Diz onde cada hora entrou como custo — é por este vínculo que o job acumula o custo de mão de obra.',
   'Campanha Verão — Cliente X',
   'Lançar horas sem job: elas não entram no custo de nenhum trabalho.',
   51, 'publicado'),

  ('pm.apontamento.col_etapa', '/dashboard/pm/apontamento-horas', 'Apontamento', 'pm',
   'Etapa',
   'Coluna só de leitura: a etapa do job em que o apontamento foi feito (quando o job trabalha por etapas).',
   'Permite ver em qual fase do trabalho as horas foram gastas e comparar o esforço entre etapas.',
   'Edição / Aprovação',
   'Confundir etapa vazia com erro: nem todo job usa etapas — fica em branco quando não há.',
   52, 'publicado'),

  ('pm.apontamento.col_horas', '/dashboard/pm/apontamento-horas', 'Apontamento', 'pm',
   'Horas',
   'Coluna só de leitura: as horas trabalhadas naquele lançamento, em decimal. A etiqueta "ruído" marca lançamentos de menos de 3 minutos.',
   'É a quantidade que soma no total de horas e vira custo do job pelo custo/hora da pessoa.',
   '1,75 (= 1 h e 45 min)',
   'Ler 1,45 como 1 h 45 min: em decimal, 1,45 h são 1 h e 27 min.',
   53, 'publicado'),

  ('pm.apontamento.col_custo', '/dashboard/pm/apontamento-horas', 'Apontamento', 'pm',
   'Custo',
   'Coluna só de leitura: o custo daquele lançamento (horas × custo/hora da pessoa). Aparece só para quem tem permissão de ver custo.',
   'Mostra quanto cada apontamento pesou no custo do job, para você revisar os lançamentos mais caros.',
   'R$ 87,50',
   'Achar que é o valor cobrado do cliente: aqui é custo interno, não preço de venda.',
   54, 'publicado'),

  ('pm.apontamento.col_descricao', '/dashboard/pm/apontamento-horas', 'Apontamento', 'pm',
   'Descrição',
   'Coluna só de leitura: a observação que a pessoa escreveu ao lançar as horas (o que foi feito).',
   'Dá contexto ao apontamento na hora de auditar — explica por que aquelas horas foram gastas.',
   'Ajustes de layout pedidos na reunião',
   'Deixar sempre em branco: sem descrição, fica difícil justificar o lançamento depois.',
   55, 'publicado')
ON CONFLICT (chave) DO NOTHING;
