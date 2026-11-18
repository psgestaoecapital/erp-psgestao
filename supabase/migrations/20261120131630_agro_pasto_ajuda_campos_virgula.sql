-- RD-95 · #5660: campos decimais da tela /dashboard/agro/pasto passaram a aceitar vírgula
-- (type=text inputMode=decimal + parseNumBR) e ganharam o "?" (AjudaCampo). Esta migration cadastra
-- as 6 chaves que a tela passa a referenciar.
--
-- Aditivo (RD-55): só INSERT em catálogo de ajuda (erp_ajuda_campo), sem DDL, RLS, função ou dado de cliente.
-- IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING — rodar 2x não duplica nem sobrescreve texto já publicado.
-- Reverter: DELETE FROM public.erp_ajuda_campo WHERE chave IN
--   ('agro.pasto.ua_categoria','agro.pasto.config.lotacao_pct','agro.pasto.config.dias_min',
--    'agro.pasto.config.altura_cm_min','agro.pasto.forrageira.nome','agro.pasto.forrageira.ua_ha',
--    'agro.pasto.avaliacao.valor');

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('agro.pasto.ua_categoria', '/dashboard/agro/pasto', 'Agro', 'UA por categoria',
   'A Unidade Animal (UA) de cada categoria do rebanho (bezerro, novilha, vaca etc.). Aceita vírgula (ex.: 0,7). O padrão vem de tabela técnica — ajuste com seu técnico para a realidade da fazenda.',
   'Converte a quantidade de animais em UA para calcular a taxa de lotação real do pasto e comparar com a capacidade dos piquetes.',
   'Bezerro(a) desmamado ≈ 0,7 UA · vaca adulta = 1 UA.',
   'Deixar o valor padrão sem confirmar com o técnico — a lotação calculada fica irreal.',
   'agro', 1),
  ('agro.pasto.config.lotacao_pct', '/dashboard/agro/pasto', 'Agro', 'Lotação % >',
   'O limite de lotação (em %) acima do qual a fazenda deve ser alertada de superlotação. Aceita vírgula.',
   'Dispara o alerta de pasto quando a lotação do piquete ultrapassa esse percentual da capacidade.',
   '110 (alerta quando passar de 110% da capacidade).',
   'Usar um limite muito alto: o alerta só aparece quando o pasto já está degradado.',
   'agro', 2),
  ('agro.pasto.config.dias_min', '/dashboard/agro/pasto', 'Agro', 'Dias ≥',
   'O número mínimo de dias de ocupação/descanso considerado no alerta. Valor inteiro.',
   'Ajuda a sinalizar piquetes ocupados tempo demais (ou com descanso insuficiente) conforme o manejo da fazenda.',
   '30 (dias).',
   'Confundir dias de ocupação com dias de descanso ao configurar.',
   'agro', 3),
  ('agro.pasto.config.altura_cm_min', '/dashboard/agro/pasto', 'Agro', 'Capim cm <',
   'A altura mínima do capim (em cm) abaixo da qual o pasto é considerado baixo. Aceita vírgula. Braquiária, mombaça e tifton pedem valores diferentes.',
   'Dispara o alerta quando a altura medida do capim fica abaixo desse limite — sinal de sobrepastejo.',
   '20 (cm) para braquiária; ajuste por forrageira.',
   'Usar a mesma altura para todas as forrageiras — cada uma tem um ponto de entrada/saída próprio.',
   'agro', 4),
  ('agro.pasto.forrageira.nome', '/dashboard/agro/pasto', 'Agro', 'Nome da forrageira',
   'O nome da forrageira/pastagem cadastrada como referência (capim). Texto livre.',
   'Identifica a forrageira na lista e no cálculo de capacidade — é ela que carrega o UA/ha sugerido.',
   'Panicum Mombaça · Braquiária Marandu · Tifton 85.',
   'Cadastrar a mesma forrageira com nomes diferentes, duplicando a referência.',
   'agro', 5),
  ('agro.pasto.forrageira.ua_ha', '/dashboard/agro/pasto', 'Agro', 'UA/ha (forrageira)',
   'A capacidade de suporte sugerida da forrageira, em UA por hectare. Aceita vírgula (ex.: 2,5).',
   'Vira a sugestão de UA/ha quando você escolhe essa forrageira no cálculo de capacidade ideal do piquete.',
   'Panicum Mombaça ≈ 2,5 UA/ha; Braquiária ≈ 1,5 UA/ha.',
   'Cadastrar um valor fora da realidade da região/solo — a sugestão de lotação sai distorcida.',
   'agro', 5),
  ('agro.pasto.avaliacao.valor', '/dashboard/agro/pasto', 'Agro', 'Valor da avaliação',
   'O valor medido na avaliação do pasto: altura do capim em cm ou massa em kg MS/ha, conforme o método escolhido. Aceita vírgula.',
   'Registra a medição que alimenta o histórico do piquete e os alertas de altura/massa do capim.',
   '22,5 (cm) no método altura; 3200 (kg MS/ha) no método massa.',
   'Informar o número no método errado (cm no lugar de kg MS/ha).',
   'agro', 6)
ON CONFLICT (chave) DO NOTHING;
