-- RD-95: "?" na tela Odonto › Rentabilidade (/dashboard/odonto/rentabilidade).
-- O auditor (PDCA) cobra "?" em todo campo/filtro/indicador. Esta tela (lucro por dentista/cadeira,
-- read-only via fn_odonto_rentabilidade) tinha 0 AjudaCampo: o filtro de período, a dimensão
-- (dentista × cadeira) e o resultado/margem ficavam sem ajuda. Aditiva/idempotente: só insere/atualiza
-- chaves de ajuda; nenhuma mudança em RLS, cálculo ou dado de cliente. Faixa desenvolvedor_4_g (segundos :45).

INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('odonto.rentabilidade.periodo', '/dashboard/odonto/rentabilidade', 'Rentabilidade', 'Período',
   'Escolha a data inicial e a final. Entram só os atendimentos CONCLUÍDOS com a data dentro desse intervalo.',
   'Define a janela do cálculo de receita, custo e lucro. Agendamento marcado mas não concluído não entra — rentabilidade é do que foi realizado.',
   'Ex.: para fechar o mês, use do dia 1º ao último dia do mês.',
   'Escolher um período sem atendimentos concluídos: a tela mostra "Sem procedimentos concluídos no período".',
   'odonto', 10, 'publicado'),
  ('odonto.rentabilidade.dimensao', '/dashboard/odonto/rentabilidade', 'Rentabilidade', 'Por dentista / Por cadeira',
   'Escolha como agrupar o resultado: por profissional (cada dentista) ou por cadeira (cada box de atendimento).',
   'Mostra onde a clínica ganha e onde perde o dinheiro — por quem atende ou por qual estrutura. Ajuda a decidir agenda, preço e custeio.',
   'Ex.: "Por dentista" mostra o lucro de cada profissional; "Por cadeira" mostra o retorno de cada box.',
   'Comparar dentista com cadeira na mesma leitura: troque a dimensão primeiro, senão a conclusão fica errada.',
   'odonto', 11, 'publicado'),
  ('odonto.rentabilidade.resultado', '/dashboard/odonto/rentabilidade', 'Rentabilidade', 'Lucro, margem e custo/hora',
   'Indicador (não se preenche). Lucro = receita executada − custo real (material + mão de obra + custo fixo rateado pela hora).',
   'Diz se cada dentista/cadeira dá lucro e qual a margem. "Parcial" aparece quando falta custeio (ficha técnica ou duração) — complete para o número fechar. O resultado também alimenta o DRE divisional da Gestão Empresarial.',
   'Ex.: margem abaixo de 25% aparece em laranja; prejuízo em vermelho.',
   'Ler a margem como fechada quando há aviso "parcial": o custo ainda não está completo.',
   'odonto', 12, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;
