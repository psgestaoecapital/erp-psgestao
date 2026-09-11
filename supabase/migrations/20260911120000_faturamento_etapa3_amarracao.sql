-- ============================================================
-- Faturamento #18 v2 · ETAPA 3 — passo 1: AMARRAÇÃO (pedido↔título↔parcela↔nota) + estado parcial
-- ============================================================
-- SPEC docs/SPEC_faturamento_etapa3_previsto_efetivacao.md (aprovado pelo CEO).
-- Pré-requisitos JÁ em produção: etapa 1 (trigger preserva 'previsto' + view v_receber_efetivo) e
-- etapa 2 ('previsto' no CHECK de erp_receber). Este passo NÃO cria previsão nem muda comportamento —
-- só adiciona as colunas de amarração que faltavam e libera o estado 'faturamento_parcial' no pedido.
-- Sem essas colunas seria impossível "efetivar as parcelas marcadas" (hoje a ligação título↔pedido é
-- só texto em numero_documento). Tudo ADITIVO e reversível (RD-30): nada é removido, nada é backfillado
-- (títulos históricos já são aberto/pago; as colunas nascem nulas e só passam a ser usadas daqui pra frente).
--
-- Colunas (as 4 aprovadas + cancelado_em, exigida pela decisão D-2 do CEO "mostre cancelado_em na linha";
-- QUEM cancelou já é capturado pelo trigger de auditoria trg_audit_erp_receber, então não vira coluna):
--   pedido_id, pedido_parcela_id, nfse_id, motivo_perda, cancelado_em.

DO $mig$
BEGIN
  -- (A) amarração em erp_receber (aditivo)
  ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS pedido_id uuid;
  ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS pedido_parcela_id uuid;
  ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS nfse_id uuid;
  ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS motivo_perda text;      -- motivo quando previsão é cancelada (§3)
  ALTER TABLE public.erp_receber ADD COLUMN IF NOT EXISTS cancelado_em timestamptz; -- quando a previsão foi cancelada (D-2)

  CREATE INDEX IF NOT EXISTS ix_receber_pedido   ON public.erp_receber (pedido_id, status);
  CREATE INDEX IF NOT EXISTS ix_receber_parcela  ON public.erp_receber (pedido_parcela_id);

  COMMENT ON COLUMN public.erp_receber.pedido_id IS 'ETAPA3: pedido de origem (permite efetivar por seleção de parcelas). Nulo em títulos avulsos/legado.';
  COMMENT ON COLUMN public.erp_receber.pedido_parcela_id IS 'ETAPA3: parcela de origem (erp_pedidos_parcelas). Uma parcela = um título.';
  COMMENT ON COLUMN public.erp_receber.nfse_id IS 'ETAPA3: nota que EFETIVOU este título (previsto→aberto). Nulo enquanto previsto.';
  COMMENT ON COLUMN public.erp_receber.motivo_perda IS 'ETAPA3: motivo do cancelamento da previsão (receita perdida, §3). Nunca DELETE.';
  COMMENT ON COLUMN public.erp_receber.cancelado_em IS 'ETAPA3: quando a previsão virou cancelado. "Receita perdida" = status=cancelado AND data_emissao IS NULL.';

  -- (B) estado 'faturamento_parcial' no pedido (medição: 1 pedido, N notas) — idempotente.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='erp_pedidos' AND c.conname='chk_pedidos_status'
      AND pg_get_constraintdef(c.oid) ILIKE '%faturamento_parcial%'
  ) THEN
    ALTER TABLE public.erp_pedidos DROP CONSTRAINT IF EXISTS chk_pedidos_status;
    ALTER TABLE public.erp_pedidos ADD CONSTRAINT chk_pedidos_status
      CHECK ((status)::text = ANY (ARRAY[
        'aberto','em_separacao','expedido','entregue','faturamento_parcial','faturado','cancelado'
      ]::text[]));
  END IF;
END $mig$;
