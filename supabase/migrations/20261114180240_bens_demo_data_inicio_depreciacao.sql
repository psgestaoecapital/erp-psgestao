-- SEED DEMO (RD-69/LGPD) · complemento do 20261111213740_seed_demo_patrimonio_ge_comercio.sql
-- Rota: /dashboard/gestao-empresarial/bens · empresa "Comércio (GE) - DEMO" (b0700000-0000-4000-a000-000000000004).
-- Pedido do auditor_pdca_2 (aud8 58/95, matriz 2026-11-09 — ANTERIOR ao seed de patrimônio,
-- que só landou 2026-11-11). Item 1 do plano: preencher data_inicio_depreciacao dos bens DEMO.
--
-- RD-38 (provado no dado em 2026-11-12, BEGIN..ROLLBACK):
--   - A DEMO já tem os 5 bens depreciáveis COM 15 linhas em erp_bem_depreciacao
--     (acum total R$ 24.308,27) — a DEPRECIAÇÃO JÁ É DEMONSTRÁVEL, porque
--     fn_bem_calcular_depreciacao ancora em COALESCE(data_inicio_depreciacao, data_aquisicao).
--   - Faltava apenas deixar data_inicio_depreciacao EXPLÍCITO: os bens semeados ficaram NULL,
--     enquanto a própria tela grava data_inicio_depreciacao := data_aquisicao no cadastro
--     (src/app/dashboard/gestao-empresarial/bens/page.tsx:125).
--
-- Esta migration alinha os 5 bens DEMO ao comportamento da tela (âncora explícito, sem depender
-- do fallback). ADITIVA, IDEMPOTENTE, SÓ empresa is_demo — NÃO toca dado de cliente real.
-- Prova RD-38 esperada: sem_data 5 -> 0; cada bem com deprec_acum > 0 e valor_contábil < aquisição.

DO $$
DECLARE
  v_co uuid := 'b0700000-0000-4000-a000-000000000004';  -- Comércio (GE) - DEMO
  v_n  int;
BEGIN
  -- segurança: só ajusta se a empresa for mesmo de demonstração (nunca cliente real)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_co AND is_demo = true) THEN
    RAISE NOTICE 'Empresa % não é is_demo; ajuste de data_inicio_depreciacao ignorado.', v_co;
    RETURN;
  END IF;

  UPDATE erp_bem
     SET data_inicio_depreciacao = COALESCE(data_inicio_depreciacao, data_aquisicao),
         updated_at = now()
   WHERE company_id = v_co
     AND deprecia = true
     AND data_inicio_depreciacao IS NULL
     AND excluido_em IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Bens DEMO com data_inicio_depreciacao preenchida (= data_aquisicao): %', v_n;
END $$;
