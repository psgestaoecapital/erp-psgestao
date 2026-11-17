-- Oficina · Comissão do mecânico (/dashboard/oficina/comissao) — RD-95: tela tinha ZERO "?" (AjudaCampo)
-- ============================================================================
-- GAP (PDCA aud8 13/11, 82/95): estrutura boa, mas nenhum campo/ação com o "?". RD-95: tela sem ajuda
--   não é entregue. Cobre TODOS: Período (de/até), botão Calcular, indicador "Comissão por mecânico",
--   e o formulário "Regras de comissão" (Mecânico, Tipo, valor, Salvar regra).
-- CORREÇÃO (aditiva, idempotente): 8 chaves em erp_ajuda_campo; o front (page.tsx) renderiza
--   <AjudaCampo chave="..."> em cada uma.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica. RD-100: linguagem do cliente, sem terceiro.
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('oficina.comissao.periodo_de', '/dashboard/oficina/comissao', 'Oficina', 'Período — De',
   'A data inicial do período que você quer calcular a comissão.',
   'Delimita o começo do intervalo: só os serviços apontados a partir dessa data entram no cálculo.',
   '01/11/2026 para calcular a comissão do mês de novembro.',
   'Deixar a data inicial depois da final — o período fica inválido e não aparece comissão.',
   'oficina', 1),

  ('oficina.comissao.periodo_ate', '/dashboard/oficina/comissao', 'Oficina', 'Período — Até',
   'A data final do período que você quer calcular a comissão.',
   'Delimita o fim do intervalo: só os serviços apontados até essa data entram no cálculo.',
   '30/11/2026 para fechar a comissão de novembro.',
   'Esquecer de ajustar a data final ao fechar o mês e calcular só até hoje.',
   'oficina', 2),

  ('oficina.comissao.calcular', '/dashboard/oficina/comissao', 'Oficina', 'Calcular',
   'Botão que recalcula a comissão de cada mecânico no período escolhido.',
   'Atualiza os valores somando as horas apontadas e a produção de cada mecânico e aplicando a regra de comissão dele.',
   'Mudar o período e tocar em "Calcular" para ver o novo total.',
   'Alterar o período e não tocar em Calcular — os valores continuam os do período anterior.',
   'oficina', 3),

  ('oficina.comissao.resultado', '/dashboard/oficina/comissao', 'Oficina', 'Comissão por mecânico',
   'Não é um campo: é o resultado do cálculo, um cartão por mecânico com a comissão, as horas, a produção e os serviços.',
   'Mostra quanto cada mecânico tem a receber de comissão no período; quem está sem regra aparece à parte e fica fora do total.',
   'João · R$ 420,00 · 32,0h · produção R$ 4.200 · 8 serviços.',
   'Estranhar o total menor: mecânico sem regra de comissão não entra no total até você cadastrar a regra abaixo.',
   'oficina', 4),

  ('oficina.comissao.regra_mecanico', '/dashboard/oficina/comissao', 'Oficina', 'Mecânico (regra)',
   'O nome do mecânico a que a regra se aplica. Em branco vale como regra padrão para todos.',
   'Permite uma comissão diferente por mecânico; a regra padrão cobre quem não tem regra própria.',
   'Deixar em branco para 10% para todos, ou escrever "Carlos" para uma regra só dele.',
   'Digitar o nome diferente do que aparece no apontamento — a regra não casa com o mecânico.',
   'oficina', 5),

  ('oficina.comissao.regra_tipo', '/dashboard/oficina/comissao', 'Oficina', 'Tipo da regra',
   'Como a comissão é calculada: percentual sobre a mão de obra ou valor fixo por hora apontada.',
   'Define a fórmula da comissão desse mecânico.',
   '"% da mão de obra" para pagar 10% do serviço, ou "R$ por hora" para pagar R$ 30 por hora.',
   'Escolher "R$ por hora" e informar um percentual (ex.: 10) — sairia R$ 10 por hora, não 10%.',
   'oficina', 6),

  ('oficina.comissao.regra_valor', '/dashboard/oficina/comissao', 'Oficina', 'Valor da regra',
   'O número da regra: o percentual (quando % da mão de obra) ou o valor em reais por hora.',
   'É o fator aplicado no cálculo da comissão conforme o tipo escolhido.',
   '10 para 10% da mão de obra, ou 30 para R$ 30,00 por hora.',
   'Digitar o símbolo % ou R$ junto do número — informe só o número (aceita vírgula).',
   'oficina', 7),

  ('oficina.comissao.regra_salvar', '/dashboard/oficina/comissao', 'Oficina', 'Salvar regra',
   'Botão que grava a regra de comissão e recalcula os valores.',
   'Guarda a regra do mecânico (ou a padrão) para ser usada neste e nos próximos cálculos.',
   'Preencher Mecânico/Tipo/Valor e tocar em "Salvar regra".',
   'Salvar sem preencher o valor — a regra fica zerada e a comissão sai R$ 0,00.',
   'oficina', 8)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
