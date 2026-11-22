-- Fluxo de caixa (/dashboard/financeiro/fluxo-caixa) · PERFORMANCE — DURÁVEL, protege TODO cliente.
-- Aditiva: só cria dois índices novos. NÃO altera dado, função, RLS, grant nem resultado de nenhuma consulta.
--
-- GAP (auditor_pdca_2, RD-38): fn_fluxo_caixa_diario na janela padrão (60d) leva ~6,8s e, em 120d,
-- ESTOURA o statement_timeout (SQLSTATE 57014) — tela de dia-a-dia inutilizável (viola RD-99).
--
-- CAUSA-RAIZ PROVADA NO DADO (DEMO GE b0700000-0000-4000-a000-000000000004, 22/11):
--   190.873 linhas FANTASMA (deleted_at IS NOT NULL, lixo de E2E soft-deletado) em erp_pagar contra 118 vivas;
--   101.679 fantasmas em erp_receber contra 29 vivas.
--   Os CTEs rec_prev/pag_prev e os vencidos de fn_fluxo_caixa_diario filtram
--   (company_id, data_vencimento no período, deleted_at IS NULL, status...). Como função plpgsql STABLE,
--   o Postgres usa PLANO GENÉRICO (parâmetros, não literais): o planner escolhe idx_erp_pagar_vencimento
--   (company_id, data_vencimento) — SEM o predicado deleted_at — e varre os fantasmas na janela,
--   descartando-os linha a linha por "Filter: deleted_at IS NULL". Provado com plan_cache_mode=force_generic_plan:
--     EXPLAIN ANALYZE → Index Scan using idx_erp_pagar_vencimento ... Filter: deleted_at IS NULL,
--     Rows Removed by Filter: 7428 (janela de 30d; a 120d passa de 110k → timeout).
--   Os índices parciais existentes ix_pagar_vivos/ix_receber_vivos cobrem só (company_id) WHERE deleted_at IS NULL
--   (sem data_vencimento), então não servem o filtro por período e o planner genérico não os prefere.
--
-- FIX (produto, independe do volume de soft-deletadas — fantasma de E2E OU histórico real grande de cliente):
--   índice parcial (company_id, data_vencimento) WHERE deleted_at IS NULL. O índice só contém linhas vivas,
--   então o planner lê APENAS as vivas na janela, qualquer que seja o plano (custom ou genérico).
--   Prova AFTER (mesma sessão, índice criado em BEGIN...ROLLBACK, force_generic_plan, janela de 120d):
--     Index Scan using ix_pagar_vivos_venc ... (actual rows=18) · Buffers: shared hit=17 read=2 · 0,26ms
--   (de varrer 7.428→110k fantasmas para ler 18 vivas).
--
-- RESULT-NEUTRAL: um índice NÃO muda o resultado de nenhuma consulta, só o plano de execução. Os filtros de
-- correctness de 18/11 (baixa de título cancelado/renegociado fora do realizado) e deleted_at IS NULL seguem intactos.
--
-- RD-52: migration é ARQUIVO + PR; versão acima da main; faixa de segundos do agente (:35). CREATE INDEX comum
-- (não CONCURRENTLY, pois db push roda em transação) — igual à migration original de ix_pagar_vivos; o build é
-- rápido (erp_pagar 89MB/202k, erp_receber 63MB/112k; build confirmado dentro de lock_timeout=5s na prova).

CREATE INDEX IF NOT EXISTS ix_pagar_vivos_venc
  ON public.erp_pagar (company_id, data_vencimento)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_receber_vivos_venc
  ON public.erp_receber (company_id, data_vencimento)
  WHERE deleted_at IS NULL;
