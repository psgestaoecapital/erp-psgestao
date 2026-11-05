-- RD-95 (CEO 08/10): "?" da tela Health Score do cliente · /dashboard/pm/health-score.
-- CONSTRUIR (tarefa eng_chefe 37420d3e) — PR (3a): camada de TELA · CONFIGURAÇÃO DOS PESOS.
-- As camadas de dados ja estao na main: #3679 (tabela agency_score_pesos + fn_agency_score_pesos_get/_salvar)
-- e #3683 (fn_agency_score_calcular, o ranking vem na PR seguinte). Esta PR entrega a tela de AJUSTE
-- dos pesos (soma = 100%, padrao preenchido) e cadastra a ajuda dos campos. Aditivo, idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/health-score', 'pm', 'publicado'
FROM (VALUES
 ('pm.health_score.tela', 'Health Score · Visão geral', 'Health Score do cliente',
  'Não se digita nada no topo: é a nota de saúde de cada cliente (0 a 100), montada a partir de quatro componentes com pesos que a agência define.',
  'Mostra, numa nota só, quais clientes estão saudáveis e quais precisam de atenção — base para priorizar o relacionamento.',
  'Um cliente que entrega no prazo, dá margem boa, paga em dia e teve atividade recente fica perto de 100 (verde).',
  'Esperar um número fixo: a nota muda conforme os pesos definidos aqui e o desempenho real do período.',
  1),
 ('pm.health_score.peso_prazo', 'Health Score · Pesos', 'Peso — Entregas no prazo',
  'Quanto a pontualidade das entregas pesa na nota final (0 a 100). A soma dos quatro pesos tem de dar 100.',
  'Dá mais ou menos importância a entregar os jobs dentro do prazo combinado com o cliente.',
  'Peso 30 = pontualidade vale 30% da nota do cliente.',
  'Somar os quatro pesos e dar diferente de 100: a tela não deixa salvar enquanto a soma não fechar em 100.',
  2),
 ('pm.health_score.peso_margem', 'Health Score · Pesos', 'Peso — Margem real do cliente',
  'Quanto a margem (receita do contrato menos o custo das horas trabalhadas) pesa na nota final (0 a 100).',
  'Valoriza clientes que dão resultado real, não só faturamento — evita priorizar cliente que dá prejuízo.',
  'Peso 30 = a rentabilidade do cliente vale 30% da nota.',
  'Confundir margem com faturamento: aqui conta o que sobra depois do custo das horas, não o valor bruto do contrato.',
  3),
 ('pm.health_score.peso_pagamento', 'Health Score · Pesos', 'Peso — Pagamento em dia',
  'Quanto a pontualidade de pagamento do cliente (contas a receber na Gestão Empresarial) pesa na nota (0 a 100).',
  'Destaca o risco financeiro: cliente bom de relacionamento mas que atrasa pagamento aparece com nota menor.',
  'Peso 20 = adimplência vale 20% da nota.',
  'Achar que inclui previsão de caixa: aqui é só o histórico de pagar em dia o que já foi cobrado.',
  4),
 ('pm.health_score.peso_atividade', 'Health Score · Pesos', 'Peso — Atividade recente',
  'Quanto o movimento recente (jobs do cliente no período) pesa na nota (0 a 100).',
  'Sinaliza clientes esfriando: quem não tem job recente perde pontos antes de virar churn.',
  'Peso 20 = atividade recente vale 20% da nota.',
  'Esperar que um cliente sem jobs recentes mantenha nota alta: a atividade baixa puxa a nota para baixo.',
  5),
 ('pm.health_score.soma', 'Health Score · Pesos', 'Soma dos pesos',
  'Indicador: a soma dos quatro pesos. Precisa ser exatamente 100 para poder salvar. Não se digita.',
  'Garante que a nota seja uma média ponderada coerente (100%), sem peso sobrando ou faltando.',
  'Prazo 30 + Margem 30 + Pagamento 20 + Atividade 20 = 100 → pode salvar.',
  'Deixar a soma em 90 ou 110: o botão Salvar fica bloqueado até fechar em 100.',
  6),
 ('pm.health_score.salvar', 'Health Score · Pesos', 'Salvar pesos',
  'Ação que grava os pesos escolhidos para esta empresa. Vale para todos os clientes dela.',
  'Aplica a régua de pontuação da agência; a mudança fica registrada (quem alterou e quando) para auditoria.',
  'Ajustar Margem para 40 e Atividade para 10 (mantendo a soma 100) e clicar em Salvar passa a valer no próximo cálculo.',
  'Salvar com a soma diferente de 100: a gravação é recusada com aviso — ajuste os pesos primeiro.',
  7)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
