-- PDCA GE · /dashboard/financeiro/fluxo-caixa · auditor_pdca_2 (gap 18/11, RD-38) · RD-69 (DEMO sem poluição E2E)
--
-- PROBLEMA (provado no dado, RD-38): a DEMO "Comércio GE" (b0700000-0000-4000-a000-000000000004)
-- acumulou 163 títulos-lixo de teste E2E em erp_receber, TODOS com valor EXATO 9.999.999.999.999,99
-- (~R$ 10 trilhões/título), descrição "...E2E..." e cliente_id NULO (nenhum vínculo a cliente real).
-- 125 já estavam cancelados+soft-deleted, mas 1 ficou ATIVO com status='pago' e baixa viva.
--
-- IMPACTO: a correção de cálculo do #5307 exclui do REALIZADO as baixas de título cancelado/renegociado,
-- mas NÃO a de um título 'pago' — então esse 1 título-lixo pago segue contando ~R$ 10 tri como caixa
-- realizado e a tela fica não-demonstrável (saldo absurdo). Prova RD-38 (read-only, hoje):
--   realizado_lixo_hoje = 9.999.999.999.999,99 ; alvo_titulos_ativos = 1 ; alvo_baixas_vivas = 163 ;
--   fora_do_escopo (não-DEMO OU com cliente) = 0.
--
-- FIX (RD-69): soft-delete (deleted_at) idempotente do lixo E2E, SÓ na empresa DEMO, SÓ nos registros com
-- a assinatura exata do lixo (valor = 9999999999999.99 E descrição ILIKE '%E2E%' E cliente_id IS NULL).
-- Nada de dado de cliente real é tocado (guarda tripla + empresa é is_demo). Soft-delete é rastreável e
-- REVERSÍVEL. Antes de alterar, grava cópia de segurança dos ids e do deleted_at antigo (bkp RD-69).
--
-- NATUREZA: RD-97 trata qualquer UPDATE em tabela de domínio (erp_receber/_baixa) como destrutivo, mesmo com
-- WHERE e mesmo sendo soft-delete reversível. Por isso esta PR é SENSÍVEL (revisao-eng-chefe) e pede a etiqueta
-- "migration-destrutiva-autorizada" ao revisor. PLANO DE VOLTA no corpo da PR.
-- Aditiva/idempotente: reexecutar não altera nada (guardas deleted_at IS NULL). Faixa :40 (code-desenvolvedor-3).

DO $rd69$
DECLARE
  v_demo      constant uuid := 'b0700000-0000-4000-a000-000000000004';  -- DEMO "Comércio GE" (is_demo)
  v_lixo_val  constant numeric := 9999999999999.99;                      -- assinatura do lixo E2E
  v_tit  int := 0;
  v_bx   int := 0;
BEGIN
  -- Só roda se a empresa existir E for DEMO (nunca toca empresa real nem ambiente sem a DEMO — vaga de testes).
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_demo AND c.is_demo = true) THEN
    RAISE NOTICE 'RD-69: DEMO Comércio GE ausente ou não-demo; nada a fazer.';
    RETURN;
  END IF;

  -- Cópia de segurança (idempotente): ids + deleted_at antigo, antes de qualquer alteração.
  CREATE TABLE IF NOT EXISTS public.erp_receber_lixo_e2e_bkp_rd69 (
    receber_id       uuid PRIMARY KEY,
    company_id       uuid NOT NULL,
    descricao        text,
    valor            numeric,
    status           text,
    deleted_at_old   timestamptz,
    capturado_em     timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.erp_receber_baixa_lixo_e2e_bkp_rd69 (
    baixa_id         uuid PRIMARY KEY,
    receber_id       uuid NOT NULL,
    company_id       uuid NOT NULL,
    valor            numeric,
    data             date,
    deleted_at_old   timestamptz,
    capturado_em     timestamptz NOT NULL DEFAULT now()
  );

  INSERT INTO public.erp_receber_lixo_e2e_bkp_rd69 (receber_id, company_id, descricao, valor, status, deleted_at_old)
  SELECT r.id, r.company_id, r.descricao, r.valor, r.status, r.deleted_at
    FROM public.erp_receber r
   WHERE r.company_id = v_demo
     AND r.valor = v_lixo_val
     AND r.descricao ILIKE '%E2E%'
     AND r.cliente_id IS NULL
  ON CONFLICT (receber_id) DO NOTHING;

  INSERT INTO public.erp_receber_baixa_lixo_e2e_bkp_rd69 (baixa_id, receber_id, company_id, valor, data, deleted_at_old)
  SELECT b.id, b.receber_id, b.company_id, b.valor, b.data, b.deleted_at
    FROM public.erp_receber_baixa b
    JOIN public.erp_receber r ON r.id = b.receber_id
   WHERE r.company_id = v_demo
     AND r.valor = v_lixo_val
     AND r.descricao ILIKE '%E2E%'
     AND r.cliente_id IS NULL
  ON CONFLICT (baixa_id) DO NOTHING;

  -- Soft-delete das BAIXAS vivas do lixo (para o ledger REALIZADO parar de somar o caixa-fantasma).
  UPDATE public.erp_receber_baixa b
     SET deleted_at = now()
    FROM public.erp_receber r
   WHERE b.receber_id = r.id
     AND r.company_id = v_demo
     AND r.valor = v_lixo_val
     AND r.descricao ILIKE '%E2E%'
     AND r.cliente_id IS NULL
     AND b.deleted_at IS NULL;
  GET DIAGNOSTICS v_bx = ROW_COUNT;

  -- Soft-delete dos TÍTULOS ativos do lixo.
  UPDATE public.erp_receber r
     SET deleted_at = now()
   WHERE r.company_id = v_demo
     AND r.valor = v_lixo_val
     AND r.descricao ILIKE '%E2E%'
     AND r.cliente_id IS NULL
     AND r.deleted_at IS NULL;
  GET DIAGNOSTICS v_tit = ROW_COUNT;

  RAISE NOTICE 'RD-69 lixo E2E (DEMO Comércio GE): % título(s) e % baixa(s) soft-deletados.', v_tit, v_bx;
END
$rd69$;

-- Tabelas de backup são registro interno de operação: RLS ligada, sem policy permissiva, REVOKE anon (gate RLS).
ALTER TABLE public.erp_receber_lixo_e2e_bkp_rd69 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_receber_baixa_lixo_e2e_bkp_rd69 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_receber_lixo_e2e_bkp_rd69 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.erp_receber_baixa_lixo_e2e_bkp_rd69 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_receber_lixo_e2e_bkp_rd69 TO service_role;
GRANT ALL ON public.erp_receber_baixa_lixo_e2e_bkp_rd69 TO service_role;
