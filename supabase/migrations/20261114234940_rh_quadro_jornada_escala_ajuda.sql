-- Indústria · /dashboard/industrial/rh/quadro — "?" RD-95 das colunas/campos de JORNADA e ESCALA
-- (carga horária e escala de trabalho por pessoa, vindos do ponto — Frioeste, CEO 11/11). ADITIVO e
-- idempotente: só linhas novas em erp_ajuda_campo (ON CONFLICT DO NOTHING). Nenhuma função/view/policy
-- muda; nenhum dado de cliente é tocado. Tabela/RPCs de jornada já no ar (ind_ponto_jornada).

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('rh.quadro.escala', '/dashboard/industrial/rh/quadro', 'Escala',
  'Nome da escala de trabalho da pessoa (ex.: "Comercial 44h", "Turno Noite"). Vem do ponto quando há integração; o RH preenche/ajusta aqui quando não há.',
  'Mostra a escala de cada pessoa junto ao cargo, base para conferir carga horária e custo/hora. Quando sincronizada do ponto aparece a marca "do ponto".',
  'Comercial 44h, Turno Noite, Escala 12x36.', 'Deixar a escala em branco esconde a jornada da pessoa na conferência do RH.'),
 ('rh.quadro.carga_horaria', '/dashboard/industrial/rh/quadro', 'Carga horária',
  'Horas por semana e/ou por mês da jornada da pessoa. Pode vir do ponto (sync) ou ser informada pelo RH.',
  'Carga horária contratada, usada para validar jornada e sustentar o custo/hora do cargo. Mostra também o horário de entrada/saída quando informado.',
  '44h/sem · 220h/mês · 08:00–17:00.', 'Horas/mês incoerentes com horas/semana distorcem o custo por hora calculado.'),
 ('rh.quadro.tipo_escala', '/dashboard/industrial/rh/quadro', 'Tipo de escala',
  'Padrão da escala: 5x2, 6x1, 12x36, Administrativo, Turno, Parcial… Escolha na lista ou digite o seu.',
  'Classifica a jornada para relatórios e para o RH validar o enquadramento (NR/CLT) da pessoa.',
  '5x2, 12x36, Administrativo.', 'Tipo de escala em branco dificulta agrupar e conferir jornadas por padrão.'),
 ('rh.quadro.jornada_horario', '/dashboard/industrial/rh/quadro', 'Horário e intervalo',
  'Hora de entrada, hora de saída e minutos de intervalo (almoço/descanso) da jornada diária.',
  'Documenta a jornada diária da pessoa; aparece resumido na coluna Carga horária e apoia a conferência de horas e intervalos.',
  'Entrada 08:00, saída 17:00, intervalo 60 min.', 'Intervalo em minutos (ex.: 60), não em horas; informar "1" significa 1 minuto de intervalo.'),
 ('rh.quadro.jornada_vigencia', '/dashboard/industrial/rh/quadro', 'Vigência da jornada',
  'Período em que esta jornada vale: início e, se houver, fim. Deixe o fim em branco para a jornada vigente.',
  'Permite guardar o histórico de jornadas da pessoa (quando mudou de escala) sem perder a anterior; a tela mostra a vigente.',
  'Início 01/01/2026, fim em branco (vigente).', 'Preencher uma vigência início diferente cria outra jornada em vez de atualizar a atual.')
ON CONFLICT (chave) DO NOTHING;
