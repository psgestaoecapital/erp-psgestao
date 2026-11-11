-- CONSERTO-MAIN urgente: regressão da #4415. O detector (fn_agente_detectar_sessao_morta) passou a gravar a
-- ação 'lease_velha_limpa' no log (passo A2), mas a constraint erp_agente_detector_log_acao_check só aceitava
-- ['lease_fantasma_limpa','tarefa_reenfileirada','fossil_alerta','acionou'] — o INSERT violava o CHECK e
-- ABORTAVA o detector inteiro (cron jobid 106 'failed' a cada 5 min desde ~20:20: sem limpar lease nem
-- re-enfileirar tarefa órfã).
--
-- Correção ADITIVA: inclui 'lease_velha_limpa' no conjunto permitido. Mantém as 4 ações existentes.
-- (A #4415 introduziu só essa ação nova no log.)
--
-- Prova RD-38: depois desta migration, o detector roda sem violar a constraint (simular + real), limpa as
-- leases > 15 min e re-enfileira as órfãs; a ação 'lease_velha_limpa' passa a gravar no log.

ALTER TABLE public.erp_agente_detector_log DROP CONSTRAINT IF EXISTS erp_agente_detector_log_acao_check;
ALTER TABLE public.erp_agente_detector_log
  ADD CONSTRAINT erp_agente_detector_log_acao_check
  CHECK (acao = ANY (ARRAY[
    'lease_fantasma_limpa'::text,
    'tarefa_reenfileirada'::text,
    'fossil_alerta'::text,
    'acionou'::text,
    'lease_velha_limpa'::text
  ]));
