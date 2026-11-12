-- Oficina · Apontamento do mecânico (/dashboard/oficina/apontamento)
-- RD-95 (GATE): a tela não tinha nenhum "?" (0 AjudaCampo). Esta migration semeia as 6 chaves dos
--   elementos principais — quem executa, serviços aprovados, ajuste manual do tempo, observação e os dois
--   indicadores Previsto/Real do rodapé. O "?" no .tsx acompanha nesta mesma PR.
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Só INSERT de texto de ajuda; NÃO altera função, RLS,
-- nem dado de cliente. Faixa de segundos do desenvolvedor_4_g (:45). Sem leitura/varredura pesada.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/oficina/apontamento', 'oficina', 'publicado'
FROM (VALUES
 ('oficina.apontamento.executor', 'Execução', 'Quem está executando',
  'Confirme quem vai trabalhar nesta OS. Por padrão entra você (mecânico logado); toque em "Trocar" para escolher outro designado da OS ou, por exceção, digitar um nome sem cadastro.',
  'O tempo apontado entra no nome de quem está executando — é como o sistema sabe de quem é a produtividade (horas trabalhadas por mecânico).',
  'Se o João abre a OS mas é o Pedro que vai fazer a troca de óleo, toque em Trocar e escolha Pedro: as horas ficam no Pedro.',
  'Deixar no seu nome quando quem trabalha é outro — aí a produtividade sai errada. Prefira sempre escolher alguém da lista (com cadastro) em vez de só digitar.', 1),
 ('oficina.apontamento.servico', 'Execução', 'Serviços aprovados',
  'Nada a preencher: é a lista dos serviços que já foram aprovados nesta OS. Toque em Iniciar para começar o cronômetro e Concluir ao terminar.',
  'Cada serviço tem o tempo Previsto (do tempário) e, depois de concluído, o tempo Real — a diferença mostra onde o trabalho está mais rápido ou mais lento que o esperado.',
  'Serviço "Troca de óleo" com Previsto 0,5h; você conclui em 40min e o Real aparece como 40min.',
  'Iniciar um serviço que ainda não foi aprovado: só aparecem aqui os que passaram pela Aprovação. Peças não têm cronômetro (aparecem só como escopo).', 2),
 ('oficina.apontamento.ajuste_tempo', 'Execução', 'Ajustar o tempo',
  'Use só por exceção, quando esqueceu de bater o ponto. Digite as horas gastas (ex.: 1,5). Deixar em branco mantém o tempo do cronômetro, que é a fonte oficial.',
  'O tempo real alimenta o tempário (média de duração de cada serviço). Por isso o padrão é o relógio: o ajuste manual é só para corrigir um esquecimento.',
  'Começou o serviço mas esqueceu de iniciar o cronômetro; ao concluir, abra "ajustar" e digite 1,5 para registrar 1h30 reais.',
  'Digitar um tempo "redondo" por preguiça quando o cronômetro estava certo — isso contamina a média do tempário. Ajuste só quando o relógio realmente não bateu.', 3),
 ('oficina.apontamento.observacao', 'Execução', 'Observação',
  'Campo opcional: escreva (ou dite por voz) o que achou do serviço, o que faltou, peça extra que precisou, etc. Fica junto da execução concluída.',
  'A observação segue com o histórico do serviço — ajuda o orçamentista e o próximo mecânico a entenderem o que de fato aconteceu, além do tempo.',
  'Ao concluir, ditar: "Parafuso do cárter espanado, troquei por um novo; recomendo trocar o filtro na próxima."',
  'Escrever dado que deveria virar item/peça da OS só na observação — se gerou custo, registre como item para entrar no faturamento, não só como texto solto.', 4),
 ('oficina.apontamento.previsto', 'Totais', 'Previsto (total)',
  'Nada a preencher: é a soma das horas previstas (do tempário) de todos os serviços aprovados desta OS.',
  'É a baliza do dia: compara com o Real para ver se a OS está dentro, acima ou abaixo do tempo esperado.',
  'Três serviços com 0,5h + 1h + 0,5h previstos somam Previsto 2h.',
  'Confundir com preço: aqui a conta é em HORAS, não em reais. Valor e margem financeira são da Gestão Empresarial.', 5),
 ('oficina.apontamento.real', 'Totais', 'Real (total)',
  'Nada a preencher: é a soma das horas realmente gastas nos serviços já concluídos desta OS (cronômetro ou tempo ajustado).',
  'Mostra o esforço efetivo. Quando o Real passa do Previsto ele fica em vermelho — sinal de serviço que demorou mais que o tempário.',
  'Previsto 2h e você fechou os serviços em 2h30: o Real aparece 2,5h em vermelho (estourou 0,5h).',
  'Ler o Real antes de concluir os serviços: ele só soma o que já foi concluído; serviço em andamento ainda não entra no total.', 6)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
