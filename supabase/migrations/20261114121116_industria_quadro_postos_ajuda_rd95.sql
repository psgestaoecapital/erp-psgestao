-- Indústria · /dashboard/produtividade — nova visão "Quadro (posto a posto)" (CEO 11/11): chaves de ajuda RD-95
-- para os indicadores, o filtro e as colunas da grade do quadro. A grade lê a RPC viva fn_rh_quadro_lotacao
-- (RD-26: mesma base do Cadastro por fluxo; custo agregado com gate de folha/LGPD). Tudo ADITIVO e idempotente:
-- só linhas novas de ajuda + registro da RPC em system_screens (RD-98). Nenhuma função/view/policy é alterada.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('industria.quadro.kpi_postos', '/dashboard/produtividade', 'Postos ativos',
  'Indicador — não se preenche.', 'Quantos postos de trabalho estão ativos no quadro da empresa (todos os setores).',
  '11 postos ativos.', 'Posto desativado não entra na conta: reative pelo Cadastro por fluxo se ele ainda existe.'),
 ('industria.quadro.kpi_ocupados', '/dashboard/produtividade', 'Postos ocupados',
  'Indicador — não se preenche.', 'Quantos postos ativos têm pelo menos uma pessoa alocada hoje.',
  '9 de 11 postos ocupados.', 'Posto sem ninguém alocado conta como vaga, não como ocupado.'),
 ('industria.quadro.kpi_vagas', '/dashboard/produtividade', 'Vagas abertas',
  'Indicador — não se preenche.', 'Postos em que o quadro real é menor que o projetado — onde falta gente para repor.',
  '2 vagas abertas.', 'Vaga = projetado − real por posto; se o projetado estiver errado, ajuste o quadro do turno.'),
 ('industria.quadro.kpi_projetado', '/dashboard/produtividade', 'Quadro projetado',
  'Indicador — não se preenche.', 'Total de pessoas que o quadro prevê (soma das pessoas por turno de cada posto).',
  'Projetado 24 pessoas.', 'O projetado vem do quadro por turno do posto; se estiver zerado, cadastre o turno.'),
 ('industria.quadro.kpi_real', '/dashboard/produtividade', 'Quadro real',
  'Indicador — não se preenche.', 'Total de pessoas realmente alocadas hoje nos postos.',
  'Real 22 pessoas.', 'Pessoa com vínculo encerrado não conta no real.'),
 ('industria.quadro.kpi_custo', '/dashboard/produtividade', 'Custo da folha (mês)',
  'Indicador — não se preenche.', 'Soma do custo mensal de mão de obra dos postos, com encargos. Só aparece para RH e diretoria (LGPD).',
  'R$ 180.000 no mês.', 'Se você não vê este número, seu perfil não tem acesso à folha — fale com o RH.'),
 ('industria.quadro.filtro_setor', '/dashboard/produtividade', 'Filtrar por setor',
  'Escolha um setor para ver só os postos dele.', 'Reduz a grade a um setor; os totais e subtotais acompanham o filtro.',
  'Setor: Abate.', 'Posto sem setor aparece em "Sem setor".'),
 ('industria.quadro.col_po', '/dashboard/produtividade', 'Nº PO',
  'Coluna — não se preenche aqui.', 'Número/código do posto de trabalho, como na planilha do quadro.',
  'PO-012.', 'Dois postos com o mesmo número confundem o quadro: use códigos únicos.'),
 ('industria.quadro.col_cargo', '/dashboard/produtividade', 'Cargo',
  'Coluna — não se preenche aqui.', 'Cargo ligado ao posto; é o que define o custo por hora da mão de obra.',
  'Faquero.', 'Posto sem cargo não calcula custo: ligue um cargo no Cadastro por fluxo.'),
 ('industria.quadro.col_atividade', '/dashboard/produtividade', 'Área / atividade',
  'Coluna — não se preenche aqui.', 'O que se faz no posto (a atividade/área do fluxo).',
  'Desossa do dianteiro.', 'Descrição genérica demais dificulta achar o posto na lista.'),
 ('industria.quadro.col_turnos', '/dashboard/produtividade', 'Pessoas por turno (T1/T2/T3)',
  'Coluna — não se preenche aqui.', 'Quantas pessoas o quadro prevê em cada turno do posto (1º, 2º e 3º).',
  'T1 = 3, T2 = 2.', 'Empresa de um turno só usa T1; T2/T3 ficam vazios — é o esperado.'),
 ('industria.quadro.col_projetado', '/dashboard/produtividade', 'Projetado (posto)',
  'Coluna — não se preenche aqui.', 'Total de pessoas previstas para o posto, somando os turnos.',
  'Projetado 5.', 'É a soma de T1+T2+T3 do posto.'),
 ('industria.quadro.col_real', '/dashboard/produtividade', 'Real (posto)',
  'Coluna — não se preenche aqui.', 'Pessoas realmente alocadas no posto hoje.',
  'Real 4.', 'Vínculo encerrado não conta.'),
 ('industria.quadro.col_vagas', '/dashboard/produtividade', 'Vagas (posto)',
  'Coluna — não se preenche aqui.', 'Quantas pessoas faltam no posto (projetado − real). Em destaque quando há vaga.',
  '1 vaga.', 'Vaga negativa (real maior que o projetado) aparece como 0 — reveja o quadro projetado.'),
 ('industria.quadro.col_custo', '/dashboard/produtividade', 'Custo do posto (mês)',
  'Coluna — não se preenche aqui.', 'Custo mensal de mão de obra do posto, com encargos. Só para RH e diretoria (LGPD).',
  'R$ 14.500 no mês.', 'Sem este número, seu perfil não vê a folha — é proteção de dado pessoal, não erro.')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: a visão Quadro consome fn_rh_quadro_lotacao (append idempotente).
UPDATE public.system_screens
SET rpcs_chamadas = (
  SELECT array_agg(DISTINCT e ORDER BY e)
  FROM unnest(COALESCE(rpcs_chamadas, '{}') || ARRAY['fn_rh_quadro_lotacao']) AS e)
WHERE rota = '/dashboard/produtividade';
