-- GE onboarding · consolida a definição de "lançamento/extrato" entre a HOME e o GUIA
-- ---------------------------------------------------------------------------
-- Problema (auditor_pdca_2 26/11, RD-38): existiam DUAS contagens de "lançamento"
-- divergentes para a MESMA empresa:
--   • HOME (DashboardRico → OnboardingStepper, via fn_onboarding_maturidade): o passo
--     "Importe extrato bancário OFX" estava preso a COUNT(erp_pagar) >= 10 — ou seja,
--     dava o extrato por "importado" só porque havia 10 contas a pagar, o que NÃO tem
--     relação com importar o extrato bancário (OFX).
--   • GUIA (/implantacao → fn_ge_onboarding_status): o passo 2 "Importe seus lançamentos"
--     usa EXISTS(erp_lancamentos) — a fonte correta do extrato importado.
-- Resultado: a home marcava "extrato OK" com erp_pagar enquanto o guia dizia "falta
-- importar lançamentos" (erp_lancamentos) para a mesma empresa.
--
-- Correção (aditiva, sem regressão): fn_onboarding_maturidade passa a devolver também
-- `extrato_lancamentos` = COUNT(erp_lancamentos) — a MESMA fonte do guia. O passo de
-- OFX da home passa a usar esse campo (ver DashboardRico.tsx), eliminando a divergência
-- de tabela. O conceito de `eh_madura` e o campo `lancamentos` (COUNT erp_pagar, usado no
-- passo "Lance sua primeira despesa ou receita" e no critério de maturidade) ficam
-- INALTERADOS — a home continua abrindo SEMPRE o dashboard real (não regride #4117).
-- Code: code-desenvolvedor-3
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_onboarding_maturidade(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_contas int;
  v_total_clientes int;
  v_total_lancamentos int;
  v_total_extrato int;
  v_total_orcamentos int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT COUNT(*) INTO v_total_contas       FROM erp_banco_contas WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_clientes     FROM erp_clientes     WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_lancamentos  FROM erp_pagar        WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_extrato      FROM erp_lancamentos  WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_total_orcamentos   FROM erp_orcamentos   WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'eh_madura', v_total_contas >= 1 AND v_total_clientes >= 3 AND v_total_lancamentos >= 10,
    'contas', v_total_contas,
    'clientes', v_total_clientes,
    'lancamentos', v_total_lancamentos,
    -- MESMA fonte do guia (fn_ge_onboarding_status passo 2): extrato bancário importado
    'extrato_lancamentos', v_total_extrato,
    'orcamentos', v_total_orcamentos,
    'pct_maturidade', LEAST(100,
      ((LEAST(v_total_contas,1)::float / 1 * 33) +
       (LEAST(v_total_clientes,3)::float / 3 * 33) +
       (LEAST(v_total_lancamentos,10)::float / 10 * 34))::int
    )
  );
END;
$function$;

-- SECURITY DEFINER: fecha a função a anon/PUBLIC e libera só a logado/serviço (check-fn-guards).
REVOKE ALL ON FUNCTION public.fn_onboarding_maturidade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_maturidade(uuid) TO authenticated, service_role;
