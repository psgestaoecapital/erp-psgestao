-- RH PR 2 follow-up (ajuste do Eng. Chefe 25/11) — 3 partes, tudo ADITIVO e idempotente:
--  (a) "Custo da mão de obra" virou a aba "Custo por setor e cargo" do Painel de RH → chave de ajuda da aba nova.
--  (b) RD-95: "?" dos 15 campos da View de RH (Lotação e remuneração variável), extraída de /inteligencia/rh.
--  (c) 5W2H duplicado: o item de menu da Indústria (industrial_plano_acao) fica ativo=false (fica só o compartilhado).
-- Nenhuma função, policy, grant ou dado de cliente é alterado. RD-30: nada é apagado (catálogo só desativado).

-- (b) 15 chaves novas da View RH · Lotação e remuneração variável. As chaves JÁ existentes desta View ficam sob o
-- rota /dashboard/inteligencia/rh (a View mantém a própria ROTA de ajuda, como as outras Views extraídas); por isso
-- estas 15 entram sob o MESMO rota, para o "?" resolver na tela.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/inteligencia/rh', 'industria', 'publicado'
FROM (VALUES
 ('rh.painel.part_salario_base', 'Remuneração variável', 'Salário base (por pessoa)',
  'O salário base mensal da pessoa, em reais. Deixe em branco para usar o valor do plano (perfil/faixa).',
  'Entra no cálculo do custo da pessoa no mês (base + variável + encargos). Ajuste individual sobrepõe o plano.',
  '2.200,00', 'Digitar o salário já com encargos: aqui é só a base; os encargos vêm no campo "% encargos".', 110),
 ('rh.painel.part_encargos_pct', 'Remuneração variável', '% de encargos (por pessoa)',
  'O percentual de encargos patronais sobre a base + horas extras desta pessoa. Em branco usa o % do plano.',
  'Define quanto a empresa paga de encargo sobre a remuneração; soma ao custo total da pessoa.',
  '36,5', 'Confundir com o INSS descontado do empregado: aqui é o encargo PATRONAL (custo da empresa).', 120),
 ('rh.painel.part_diaria_dia', 'Remuneração variável', 'Diária (R$/dia, por pessoa)',
  'Valor da diária por dia trabalhado. O total da diária = valor/dia × dias apurados, salvo se você informar a diária total.',
  'Compõe a parte variável de quem recebe por diária.',
  '80,00', 'Preencher aqui E a diária total: a total manual tem prioridade e ignora os dias.', 130),
 ('rh.painel.part_diaria_total', 'Remuneração variável', 'Diária total (manual, por pessoa)',
  'Valor FECHADO da diária no mês. Deixe vazio para calcular por dias × valor/dia.',
  'Permite travar a diária do mês num total combinado, sem depender da contagem de dias.',
  '1.600,00', 'Esquecer de limpar a diária total do mês anterior: ela continua valendo e ignora os dias.', 140),
 ('rh.painel.part_entregas_mes', 'Remuneração variável', 'Entregas do mês (total)',
  'Total de entregas da pessoa no mês, digitado de uma vez. Substitui a soma dos lançamentos diários.',
  'Alimenta o "valor por entrega" da remuneração variável quando você controla por total mensal, não dia a dia.',
  '320', 'Digitar o total mensal e também lançar entregas por dia: o total do mês passa a valer e ignora os dias.', 150),
 ('rh.painel.lancardia_data', 'Lançar dia', 'Data do lançamento',
  'O dia que você está lançando (entregas/infração por pessoa). Mês fechado não aceita lançamento.',
  'Define a competência e o dia dos lançamentos diários de produção.',
  '15/11/2026', 'Tentar lançar em competência já fechada (enviada à folha): o sistema bloqueia.', 210),
 ('rh.painel.lancardia_entregas', 'Lançar dia', 'Entregas do dia',
  'Quantidade de entregas da pessoa naquele dia. Número inteiro.',
  'Soma às entregas do mês quando você controla a produção dia a dia.',
  '12', 'Lançar o total do mês aqui: este campo é só do DIA; o total mensal tem campo próprio.', 220),
 ('rh.painel.lancardia_infracao', 'Lançar dia', 'Houve infração',
  'Marque se a pessoa teve uma infração naquele dia.',
  'Infração registrada pode zerar o bônus "sem infração" conforme o plano.',
  'Marcado quando houve ocorrência.', 'Marcar por engano: revise antes de fechar a competência, pois afeta o bônus.', 230),
 ('rh.painel.lancardia_tipo_infracao', 'Lançar dia', 'Tipo da infração',
  'Como a infração foi registrada: "registrada" (formal) ou "verbal". Aparece só quando "houve infração" está marcado.',
  'Classifica a ocorrência; o plano pode tratar registrada e verbal de formas diferentes no bônus.',
  'registrada', 'Deixar como verbal uma ocorrência que foi formalizada: confira o tipo real.', 240),
 ('rh.painel.plano_valor_campo', 'Participantes · plano', 'Valores do plano (perfil × faixa)',
  'Os valores padrão do plano para cada perfil/faixa: salário base, diária, prêmios, INSS, metas. Aplicam-se a quem usa o plano, salvo ajuste individual.',
  'É a fonte única dos valores da remuneração variável por perfil; evita redigitar pessoa a pessoa.',
  'Salário base 2.200,00 · Diária 80,00 · Meta 300.', 'Mudar aqui achando que muda só uma pessoa: altera o plano de TODOS daquele perfil/faixa.', 310),
 ('rh.painel.part_busca_func', 'Participantes', 'Buscar funcionário',
  'Digite parte do nome ou do cargo para filtrar a lista de funcionários disponíveis.',
  'Ajuda a achar rápido quem incluir no plano de remuneração variável.',
  'silva', 'Esperar que a busca traga quem já está no plano: ela lista os DISPONÍVEIS para incluir.', 320),
 ('rh.painel.part_sel_func', 'Participantes', 'Funcionário a incluir',
  'Escolha o funcionário que entra no plano de remuneração variável. A lista vem do Ponto (fonte da verdade).',
  'Define quem será incluído como participante do plano na competência.',
  'João da Silva · Motorista', 'Procurar alguém que não está no Ponto: só aparece quem tem cadastro no Ponto.', 330),
 ('rh.painel.part_sel_plano', 'Participantes', 'Plano do funcionário',
  'O plano (perfil/faixa) que o funcionário vai seguir. Define os valores-base da variável dele.',
  'Vincula a pessoa a um conjunto de valores do plano; pode ser ajustado individualmente depois.',
  'Motorista / Pleno', 'Incluir sem escolher o plano: sem plano a variável fica sem base de cálculo.', 340),
 ('rh.painel.ajuste_tipo', 'Ajuste individual', 'Tipo do ajuste',
  'Se o ajuste SOMA (adicional +) ou SUBTRAI (desconto −) do total da pessoa no mês.',
  'Permite corrigir pontualmente a remuneração de uma pessoa (prêmio extra, desconto combinado) sem mexer no plano.',
  'Adicional (+)', 'Escolher adicional quando era desconto: confira o sinal, pois muda o custo.', 410),
 ('rh.painel.ajuste_motivo', 'Ajuste individual', 'Motivo do ajuste',
  'Por que o ajuste está sendo feito. Obrigatório — fica no histórico da competência.',
  'Deixa rastro de quem ajustou e por quê (auditoria da folha).',
  'Prêmio de produtividade combinado com o gestor.', 'Deixar vazio: o sistema exige o motivo para registrar o ajuste.', 420)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- (a) Chave de ajuda da aba nova "Custo por setor e cargo" do Painel de RH (rota do Painel: /industrial/rh/bi).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('industrial.rh.painel.aba.custo', 'Painel de RH', 'Aba Custo por setor e cargo',
  'Nada — é a aba de custo da mão de obra, agora dentro do Painel de RH.',
  'Mostra o custo da mão de obra a partir da folha (com encargos), por pessoa, setor e equipe.',
  'Custo por setor, custo por equipe.',
  'Mudar o % de encargos aqui: o % se edita em Folha › Encargos.',
  30, '/dashboard/industrial/rh/bi', 'industria', 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- (c) 5W2H duplicado: desativa o item de menu da Indústria (fica só o compartilhado plano_acao_5w2h). RD-30: a rota
-- vira redirect e o catálogo só é DESATIVADO (nada apagado). Idempotente.
UPDATE public.module_catalog SET ativo = false WHERE id = 'industrial_plano_acao' AND ativo IS DISTINCT FROM false;
