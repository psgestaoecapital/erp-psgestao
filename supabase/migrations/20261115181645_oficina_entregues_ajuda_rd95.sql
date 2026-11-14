-- Oficina · Veículos entregues (/dashboard/oficina/entregues) — RD-95: tela tinha ZERO "?" (AjudaCampo)
-- ============================================================================
-- GAP (PDCA aud8 13/11, 84/95): empty state bom, mas nenhum filtro/indicador/aba com o "?". RD-95:
--   tela sem ajuda não é entregue. Cobre: abas (Histórico/A faturar/Sem nota), filtros de data (de/até),
--   busca e o indicador "Entregas no período".
-- CORREÇÃO (aditiva, idempotente): 5 chaves em erp_ajuda_campo; o front renderiza <AjudaCampo chave="...">.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica. RD-100: linguagem do cliente, sem terceiro.
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('oficina.entregues.abas', '/dashboard/oficina/entregues', 'Oficina', 'Visões',
   'Escolha a visão: Histórico (o que saiu no período), A faturar (entregues ainda não cobradas) ou Sem nota (entregues sem documento fiscal).',
   'Separa três perguntas diferentes: o que já entregou, o dinheiro parado por faturar e a obrigação fiscal pendente.',
   'Abrir "A faturar" para achar serviço entregue que ainda não virou cobrança.',
   'Procurar uma entrega recente na aba "A faturar" quando ela já foi faturada — ela está no Histórico.',
   'oficina', 1),

  ('oficina.entregues.data_de', '/dashboard/oficina/entregues', 'Oficina', 'De (entrega)',
   'A data inicial do período de entregas que você quer ver (vale para a aba Histórico).',
   'Limita o histórico ao intervalo escolhido pela data em que a OS foi entregue.',
   '01/11/2026 para ver as entregas a partir de novembro.',
   'Deixar a data inicial depois da final — o período não traz nenhuma entrega.',
   'oficina', 2),

  ('oficina.entregues.data_ate', '/dashboard/oficina/entregues', 'Oficina', 'Até',
   'A data final do período de entregas (vale para a aba Histórico).',
   'Fecha o intervalo do histórico pela data de entrega.',
   '30/11/2026 para ver as entregas até o fim de novembro.',
   'Esquecer de ampliar a data final e não encontrar a entrega de ontem.',
   'oficina', 3),

  ('oficina.entregues.busca', '/dashboard/oficina/entregues', 'Oficina', 'Buscar',
   'Digite parte da placa, do nome do cliente ou do número da OS para filtrar a lista.',
   'Acha rápido uma entrega específica sem rolar toda a lista do período.',
   'Digitar "ABC1D23" ou "João" ou "00123".',
   'Buscar por um dado que não está na entrega (ex.: telefone) — a busca é por placa, cliente ou número da OS.',
   'oficina', 4),

  ('oficina.entregues.entregas_periodo', '/dashboard/oficina/entregues', 'Oficina', 'Entregas no período',
   'Não é um campo: é o indicador com a quantidade de OS entregues no período filtrado.',
   'Mostra em um número quantos serviços/veículos saíram no intervalo escolhido.',
   '"Entregas no período · 12" = 12 OS entregues entre as datas.',
   'Estranhar o número menor que o esperado — ele conta só o período filtrado; amplie as datas para ver mais.',
   'oficina', 5)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
