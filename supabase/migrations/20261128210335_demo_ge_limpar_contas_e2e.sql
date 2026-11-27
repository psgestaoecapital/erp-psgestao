-- 20261128210335 · code-desenvolvedor-3 · PDCA auditor_pdca_2 27/11 (faceta nova da RAIZ do vazamento e2e, msg e3802e1f)
-- Remove a poluição e2e "Conta E2E <hash>" de erp_banco_contas na DEMO GE (004). Mesmo vazamento das contas
-- "ACEITE PARCIAL" (#5920), outra assinatura: broadening da função durável já existente.
--
-- RD-38 (provado no dado 27/11, DEMO GE b0700000-...-0004):
--   • 48 contas com nome ILIKE 'Conta E2E%' (todas saldo_atual 0, ativas) — afogam as 2 reais
--     (DEMO-GE Caixa, DEMO-GE Conta Corrente) na vitrine /dashboard/financeiro/razao-financeiro e
--     aparecem em contas-bancarias, caixa-grupo e conciliacao;
--   • referenciadas APENAS por erp_receber (96 linhas), TODAS já soft-deletadas (deleted_at NOT NULL,
--     0 vivos) — as outras 10 FKs de erp_banco_contas = 0; logo o DELETE não quebra nenhuma FK viva;
--   • 0 conta 'Conta E2E%' em empresa NÃO-demo → a guarda is_demo não toca nenhum cliente.
--
-- SÓ-DEMO: toda escrita é guardada por companies.is_demo = true. NUNCA toca conta de cliente.
-- Estende fn_demo_ge_limpar_contas_teste (#5920), que já roda a cada fn_demo_reset da GE — assim a lista
-- não volta a inflar entre rodadas de e2e, sem precisar reescrever o fn_demo_reset.
-- Aditiva e idempotente (reaplicar não duplica; sem lixo, remove 0).

-- ── (1) Broadening da função durável: ACEITE PARCIAL + Conta E2E ──
-- ci-sem-guarda: fn_demo_ge_limpar_contas_teste — função de DEMO (RD-69): grava SÓ em empresa is_demo (valida is_demo no topo); nenhum dado de cliente é tocado.
CREATE OR REPLACE FUNCTION public.fn_demo_ge_limpar_contas_teste(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_is_demo boolean;
  v_contas  int := 0;
  v_fk      int := 0;
BEGIN
  SELECT c.is_demo INTO v_is_demo FROM public.companies c WHERE c.id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- Desvincula os títulos de receber (todos já soft-deletados) para liberar a FK antes do DELETE.
  -- NUNCA apaga erp_receber; só zera a referência à conta de teste que será removida.
  WITH upd AS (
    UPDATE public.erp_receber r
       SET conta_bancaria_id = NULL, updated_at = now()
     WHERE r.company_id = p_company_id
       AND r.conta_bancaria_id IN (
         SELECT b.id FROM public.erp_banco_contas b
          WHERE b.company_id = p_company_id
            AND (b.nome ILIKE 'ACEITE PARCIAL %' OR b.nome ILIKE 'Conta E2E%'))
    RETURNING 1
  )
  SELECT count(*) INTO v_fk FROM upd;

  DELETE FROM public.erp_banco_contas
   WHERE company_id = p_company_id
     AND (nome ILIKE 'ACEITE PARCIAL %' OR nome ILIKE 'Conta E2E%');
  GET DIAGNOSTICS v_contas = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'contas_removidas', v_contas, 'receber_desvinculados', v_fk);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_demo_ge_limpar_contas_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_ge_limpar_contas_teste(uuid) TO authenticated, service_role;

-- ── (2) Limpeza one-time do estado atual (backup antes) ──
-- Backup só do lixo 'Conta E2E%' que será removido (idempotente: recria a tabela a cada aplicação).
DROP TABLE IF EXISTS public.erp_banco_contas_e2e_bkp_pdca1127;
CREATE TABLE public.erp_banco_contas_e2e_bkp_pdca1127 AS
  SELECT * FROM public.erp_banco_contas
   WHERE company_id = 'b0700000-0000-4000-a000-000000000004'::uuid
     AND nome ILIKE 'Conta E2E%';
ALTER TABLE public.erp_banco_contas_e2e_bkp_pdca1127 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_banco_contas_e2e_bkp_pdca1127 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_banco_contas_e2e_bkp_pdca1127 TO service_role;

-- Executa a limpeza durável uma vez para a DEMO GE (a função valida is_demo internamente).
SELECT public.fn_demo_ge_limpar_contas_teste('b0700000-0000-4000-a000-000000000004'::uuid);
