-- Indústria · Produção (/dashboard/industrial/producao) — RD-95: "?" nos filtros da tela
-- ============================================================================
-- GAP (PDCA indústria / RD-95): a tela de Produção não tinha "?" nos filtros — período (intervalo
--   de datas), lote e câmara. Agora cada controle tem ajuda.
-- CORREÇÃO (aditiva, idempotente): três chaves em erp_ajuda_campo (o período cobre o intervalo
--   dataIni–dataFim); o front renderiza <AjudaCampo> ao lado de cada filtro.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('industrial.producao.filtro_periodo', '/dashboard/industrial/producao', 'Produção', 'Período',
   'O intervalo de datas da produção que você quer ver. Use os atalhos (Hoje, 7 dias, 30 dias, Mês) ou o 🗓️ para escolher início e fim.',
   'Define quais dias entram nos números da tela (cabeças, lotes, câmaras) — todos os indicadores somam só o período escolhido.',
   'Últimos 30 dias, ou 01/11 a 14/11', 'Se a tela ficar vazia, amplie o período: pode não ter havido produção nesses dias.', 'industria', 10),

  ('industrial.producao.filtro_lote', '/dashboard/industrial/producao', 'Produção', 'Lote',
   'Escolha um lote para ver só a produção dele, ou "Todos os lotes" para ver tudo do período.',
   'Isola um lote específico para conferir cabeças, câmaras e rendimento daquele lote.',
   'Lote 240', 'O número ao lado ("Todos os lotes (N)") mostra quantos lotes existem no período atual.', 'industria', 20),

  ('industrial.producao.filtro_camara', '/dashboard/industrial/producao', 'Produção', 'Câmara',
   'Escolha uma câmara para ver só o que passou por ela, ou "Todas as câmaras" para ver tudo.',
   'Permite acompanhar a ocupação e o giro de uma câmara fria específica no período.',
   'Câmara 3', 'Combine com o filtro de lote para ver a produção de um lote dentro de uma câmara.', 'industria', 30)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
