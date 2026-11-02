-- PDCA Hub · /dashboard/projetos/desempenho (aud8 78/95)
-- GAP (RD-38): KPIs de desempenho contam "Ganhas" por data_fechamento BETWEEN
-- período (fn_crm_desempenho). Ganhos legados/seed nunca receberam
-- data_fechamento (17 de 28 ganhos com data NULL), ficando INVISÍVEIS nos cards
-- Ganhas/Ticket/Comissão/Conversão/Velocidade e no Funil — subcontagem de ~60%.
-- A fn_crm_oportunidade_ganhar já grava COALESCE(data_fechamento, now()) para os
-- novos; falta só fechar o histórico.
--
-- Aditiva: só preenche data NULA de ganhos/perdidos, usando o carimbo coerente
-- (updated_at, com fallback created_at). Idempotente: o WHERE data_fechamento IS
-- NULL faz reexecução não mexer em nada. Volume trivial (dezenas de linhas).
--
-- Prova (BEGIN/ROLLBACK em produção, 01/11): antes ganhos_com_data=11/28;
-- depois 28/28. (0 perdidos sem data; todos os alvos têm fallback.)
UPDATE public.erp_crm_oportunidade
   SET data_fechamento = COALESCE(updated_at, created_at)::date
 WHERE etapa IN ('ganho', 'perdido')
   AND data_fechamento IS NULL
   AND deleted_at IS NULL
   AND COALESCE(updated_at, created_at) IS NOT NULL;
