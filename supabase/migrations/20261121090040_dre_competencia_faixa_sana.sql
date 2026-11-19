-- ════════════════════════════════════════════════════════════════════════════
-- DRE · competência com ano absurdo tira receita real do mês certo
-- Tarefa PDCA GE · /dashboard/financeiro/dre-consolidado · Code: code-desenvolvedor-3
--
-- PROBLEMA (provado no dado, RD-38): títulos com data_competencia em ANO impossível
-- (typo de digitação) ficam "estacionados" num ano fantasma. O DRE só olha anos sãos
-- (seletor de 2024 a ano_atual+1), então essa receita/despesa SOME do mês certo e o
-- DRE mente para menos. Caso real: cliente Gean (Jhonartan) — R$903,84 de ago/2026
-- presos no "ano 2" (data_competencia '0002-08-11').
--
-- Varredura em produção (antes): 7 títulos REAIS com ano absurdo, todos com o
-- data_emissao correto em 2026 — ano é digitação errada:
--   erp_receber  6a02b6ac… Gean/Jhonartan R$403,84  '0002-08-11'  (pago)
--   erp_receber  1b0a2be1… Gean/Jhonartan R$500,00  '0002-08-11'  (pago)
--   erp_receber  c5baed7b… Gean/Jhonartan R$500,00  '0002-08-11'  (vencido)
--   erp_receber  63be59c8… Gean/VISUALIZA R$361,66  '20026-08-27' (pago)
--   erp_receber  534d17d2… Gean/VISUALIZA R$361,67  '20026-08-27' (pago)
--   erp_receber  16b5c230… Gean/VISUALIZA R$361,67  '20026-08-27' (pago)
--   erp_pagar    0d06c87a… Salário Jordana R$2500,00 '0226-08-01' (pago)
-- (A linha DEMO ano=2099 NÃO é tocada aqui: é lixo de E2E da Demonstração, tratado
--  pelo fn_demo_reset nas tarefas de pollution; 2099 < 2100 fica fora deste conserto.)
--
-- 1) CORREÇÃO (aditiva, só a competência — não toca valor/status/pagamento):
--    ano da competência := ano do data_emissao, PRESERVANDO mês/dia. Idempotente
--    (após rodar, nenhuma linha casa a faixa absurda). audit_log automático pelo
--    trigger trg_audit_erp_{receber,pagar}; reprocessamento do DRE automático pelo
--    trigger trg_psgc_{receber,pagar} (AFTER UPDATE enfileira o lançamento).
-- 2) BACKSTOP no banco: CHECK NOT VALID que barra ano fantasma em QUALQUER via nova
--    (form/import/ETL). NOT VALID = não varre as 98k/189k linhas no deploy e não
--    reprova linhas antigas; só vale para INSERT/UPDATE novos. Faixa folgada
--    [2000-01-01, 2100-01-01): a mensagem amigável e o teto apertado (ano_atual+5)
--    ficam na tela (src/lib/financeiro/competencia.ts). 2099 (E2E) passa de propósito.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Correção dos títulos reais com ano de competência impossível ------------------
UPDATE public.erp_receber
   SET data_competencia = make_date(
         EXTRACT(YEAR  FROM data_emissao)::int,
         EXTRACT(MONTH FROM data_competencia)::int,
         EXTRACT(DAY   FROM data_competencia)::int)
 WHERE data_emissao IS NOT NULL
   AND (data_competencia < DATE '2000-01-01' OR data_competencia >= DATE '2100-01-01');

UPDATE public.erp_pagar
   SET data_competencia = make_date(
         EXTRACT(YEAR  FROM data_emissao)::int,
         EXTRACT(MONTH FROM data_competencia)::int,
         EXTRACT(DAY   FROM data_competencia)::int)
 WHERE data_emissao IS NOT NULL
   AND (data_competencia < DATE '2000-01-01' OR data_competencia >= DATE '2100-01-01');

-- 2) Backstop: CHECK de faixa sã da competência (idempotente no re-run) -------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_competencia_sana' AND conrelid = 'public.erp_receber'::regclass
  ) THEN
    ALTER TABLE public.erp_receber
      ADD CONSTRAINT chk_competencia_sana
      CHECK (data_competencia IS NULL
             OR (data_competencia >= DATE '2000-01-01' AND data_competencia < DATE '2100-01-01'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_competencia_sana' AND conrelid = 'public.erp_pagar'::regclass
  ) THEN
    ALTER TABLE public.erp_pagar
      ADD CONSTRAINT chk_competencia_sana
      CHECK (data_competencia IS NULL
             OR (data_competencia >= DATE '2000-01-01' AND data_competencia < DATE '2100-01-01'))
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT chk_competencia_sana ON public.erp_receber IS
  'Faixa sã da competência [2000, 2100): barra typo de ano (0002/20026) em qualquer via. Mensagem amigável e teto ano_atual+5 na tela (lib/financeiro/competencia.ts). code-desenvolvedor-3.';
COMMENT ON CONSTRAINT chk_competencia_sana ON public.erp_pagar IS
  'Faixa sã da competência [2000, 2100): barra typo de ano (0002/20026) em qualquer via. Mensagem amigável e teto ano_atual+5 na tela (lib/financeiro/competencia.ts). code-desenvolvedor-3.';
