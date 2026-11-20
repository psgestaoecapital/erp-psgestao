-- PDCA GE · /dashboard/financeiro/caixa-grupo · RD-69/RD-38/RD-30 (code-desenvolvedor-3)
-- GAP do auditor (foto 20/11): o headline dourado do caixa de grupo mostra "R$ 10,0 tri" — saldo IRREAL
-- que quebra a confiança da tela. Causa: título de teste VIVO (deleted_at IS NULL) na DEMO Comércio (GE)
-- gerado por e2e — "Mensalidade E2E <run>" de R$ 9.999.999.999.999,99, status 'vencido'. A maioria desses
-- títulos de teste JÁ estava soft-deletada; sobrou 1 vivo que domina o somatório do grupo.
--
-- ESTA MIGRATION (aditiva, idempotente, SÓ DEMO, SÓ padrão de teste — NUNCA toca título de cliente real):
--   1) fn_demo_ge_limpar_titulos_absurdos_teste(company): SOFT-DELETE (deleted_at, auditável — RD-30 proíbe
--      DELETE físico em documento financeiro) dos títulos de VALOR ABSURDO (>= R$ 1 bi) marcados como e2e
--      ("Mensalidade E2E ..." ou "E2E guarda teto ...absurdo"), em erp_receber e erp_pagar. Guarda is_demo.
--      Exclui status 'pago'/'parcial' (RD: nunca apaga/altera título pago).
--   2) roda a limpeza UMA vez na DEMO Comércio (GE) de produção (one-time).
-- A recorrência é barrada pela higiene do próprio e2e (afterEach) — fora do escopo desta PR (só limpeza).
-- NÃO toca fn_demo_reset (em revisão em outra PR); limpeza one-shot + reusável.
--
-- RD-38 (provado em produção, BEGIN..ROLLBACK, DEMO b07...0004):
--   ANTES : 1 título absurdo vivo (>= R$ 1 bi, deleted_at IS NULL)
--   DEPOIS: 0 títulos absurdos vivos. Nenhum título 'pago'/'parcial' tocado; nenhum título real existe na DEMO GE.

-- ci-sem-guarda: fn_demo_ge_limpar_titulos_absurdos_teste — função de DEMO (RD-69): grava SÓ em empresa is_demo
--   (validado em v_is_demo; retorna erro para company não-demo). Dado 100% fake; nenhum cliente real é tocado.
-- ci-allow-anon: função de DEMO/teste, não é rota pública; REVOKE de anon aplicado logo após a definição.
CREATE OR REPLACE FUNCTION public.fn_demo_ge_limpar_titulos_absurdos_teste(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean;
  n_rec int := 0; n_pag int := 0;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo INTO v_is_demo FROM public.companies c WHERE c.id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo'); END IF;

  WITH upd AS (
    UPDATE public.erp_receber r SET deleted_at = now()
     WHERE r.company_id = p_company_id AND r.deleted_at IS NULL
       AND r.valor >= 1e9
       AND (r.descricao ILIKE 'Mensalidade E2E%' OR r.descricao ILIKE 'E2E guarda teto %absurdo%')
       AND r.status NOT IN ('pago','parcial')
    RETURNING 1
  ) SELECT count(*) INTO n_rec FROM upd;

  WITH upd AS (
    UPDATE public.erp_pagar p SET deleted_at = now()
     WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
       AND p.valor >= 1e9
       AND (p.descricao ILIKE 'Mensalidade E2E%' OR p.descricao ILIKE 'E2E guarda teto %absurdo%')
       AND p.status NOT IN ('pago','parcial')
    RETURNING 1
  ) SELECT count(*) INTO n_pag FROM upd;

  RETURN jsonb_build_object('ok', true, 'receber_soft_deletados', n_rec, 'pagar_soft_deletados', n_pag);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_ge_limpar_titulos_absurdos_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_ge_limpar_titulos_absurdos_teste(uuid) TO authenticated, service_role;

-- 2) Limpeza one-time na DEMO Comércio (GE) de produção
SELECT public.fn_demo_ge_limpar_titulos_absurdos_teste('b0700000-0000-4000-a000-000000000004'::uuid);
