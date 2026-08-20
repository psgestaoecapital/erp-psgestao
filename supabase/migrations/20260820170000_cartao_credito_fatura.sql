-- Contas Bancárias · Cartão de Crédito — vínculo de conta + ciclo de fatura + nº final.
--
-- erp_banco_contas já tem tipo_conta (inclui 'cartao') e limite_credito (RD-26). Faltavam os
-- campos do ciclo de fatura e o vínculo com a conta corrente que paga a fatura. Adiciona:
--   • conta_corrente_vinculada_id — de qual conta a fatura debita (self-FK; SET NULL se a conta some).
--   • dia_fechamento_fatura / dia_vencimento_fatura — ciclo (1–31).
--   • numero_cartao_final — SÓ os últimos 4 dígitos (Pilar 2 / PCI-DSS: NUNCA o PAN completo).
--
-- Pilar 2 (INEGOCIÁVEL): jamais armazenar PAN completo, CVV ou validade. O CHECK abaixo garante
-- no banco que numero_cartao_final aceita no máximo 4 dígitos — defesa em profundidade além do front.

ALTER TABLE public.erp_banco_contas
  ADD COLUMN IF NOT EXISTS conta_corrente_vinculada_id uuid,
  ADD COLUMN IF NOT EXISTS dia_fechamento_fatura        int,
  ADD COLUMN IF NOT EXISTS dia_vencimento_fatura        int,
  ADD COLUMN IF NOT EXISTS numero_cartao_final          text;

DO $$
BEGIN
  -- self-FK: a conta corrente que paga a fatura. SET NULL preserva o cartão se a conta for removida.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_banco_contas_cc_vinculada_fkey') THEN
    ALTER TABLE public.erp_banco_contas
      ADD CONSTRAINT erp_banco_contas_cc_vinculada_fkey
      FOREIGN KEY (conta_corrente_vinculada_id) REFERENCES public.erp_banco_contas(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_banco_contas_dia_fechamento_chk') THEN
    ALTER TABLE public.erp_banco_contas
      ADD CONSTRAINT erp_banco_contas_dia_fechamento_chk
      CHECK (dia_fechamento_fatura IS NULL OR dia_fechamento_fatura BETWEEN 1 AND 31);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_banco_contas_dia_vencimento_chk') THEN
    ALTER TABLE public.erp_banco_contas
      ADD CONSTRAINT erp_banco_contas_dia_vencimento_chk
      CHECK (dia_vencimento_fatura IS NULL OR dia_vencimento_fatura BETWEEN 1 AND 31);
  END IF;

  -- Pilar 2: só dígitos, no máximo 4. Barra PAN/estruturas maiores diretamente no schema.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_banco_contas_cartao_final_chk') THEN
    ALTER TABLE public.erp_banco_contas
      ADD CONSTRAINT erp_banco_contas_cartao_final_chk
      CHECK (numero_cartao_final IS NULL OR numero_cartao_final ~ '^[0-9]{1,4}$');
  END IF;
END $$;

COMMENT ON COLUMN public.erp_banco_contas.conta_corrente_vinculada_id IS 'Conta corrente de onde a fatura deste cartão debita.';
COMMENT ON COLUMN public.erp_banco_contas.dia_fechamento_fatura IS 'Dia (1-31) em que a fatura do cartão fecha.';
COMMENT ON COLUMN public.erp_banco_contas.dia_vencimento_fatura IS 'Dia (1-31) em que a fatura do cartão vence/é paga.';
COMMENT ON COLUMN public.erp_banco_contas.numero_cartao_final IS 'Pilar 2 / PCI-DSS: SOMENTE os 4 últimos dígitos, para identificação. Nunca o PAN completo, CVV ou validade.';
