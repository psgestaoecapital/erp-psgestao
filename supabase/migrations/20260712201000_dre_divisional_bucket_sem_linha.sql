-- ============================================================
-- FASE 2 (aditivo) · DRE Divisional — bucket "Sem linha de negócio".
--
-- Um zero MENTE; um bucket INFORMA. As receitas do mês que não têm vínculo de
-- linha de negócio (linha_negocio NULL no lançamento → ln_id NULL) sumiam, e a
-- DRE mostrava 5 linhas em R$0 mesmo havendo faturamento. Agora a receita não
-- classificada aparece numa linha "Sem linha de negócio" — a soma fecha com o
-- faturamento e o dono vê que precisa classificar (config), não que não vendeu.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_ge_dre_divisional(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mes int := EXTRACT(MONTH FROM CURRENT_DATE);
  v_ano int := EXTRACT(YEAR FROM CURRENT_DATE);
  v_linhas jsonb;
  v_total_realizado numeric := 0;
  v_total_orcado numeric := 0;
  v_pct_geral numeric;
  v_receita_total numeric := 0;
  v_sem_linha numeric := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_subscriptions
    WHERE company_id = p_company_id AND plan_id = 'v15_gestao_empresarial_pro' AND status = 'active') THEN
    RETURN jsonb_build_object('sem_plano', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM linhas_negocio WHERE empresa_id = p_company_id) THEN
    RETURN jsonb_build_object('company_id', p_company_id, 'empty_state', true,
      'mensagem', 'Empresa sem linhas de negocio configuradas (DRE Divisional opcional)');
  END IF;

  WITH realizado AS (
    SELECT ln.id AS linha_id, ln.nome AS linha_nome,
      COALESCE(SUM(d.receita_bruta), 0) AS receita_realizada
    FROM linhas_negocio ln
    LEFT JOIN m2_dre_divisional d ON d.ln_id = ln.id AND d.year = v_ano AND d.month = v_mes
    WHERE ln.empresa_id = p_company_id
    GROUP BY ln.id, ln.nome
  ),
  orcado AS (
    SELECT linha_id, COALESCE(SUM(receita_budget), 0) AS receita_orcada
    FROM linhas_negocio_budget
    WHERE empresa_id = p_company_id AND ano = v_ano AND mes = v_mes
    GROUP BY linha_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'linha_id', r.linha_id, 'linha_nome', r.linha_nome,
      'realizado', r.receita_realizada, 'orcado', COALESCE(o.receita_orcada, 0),
      'pct_atingido', CASE WHEN COALESCE(o.receita_orcada, 0) = 0 THEN NULL
        ELSE ROUND((r.receita_realizada / o.receita_orcada) * 100, 0) END,
      'status', CASE WHEN COALESCE(o.receita_orcada, 0) = 0 THEN 'sem_orcamento'
        WHEN r.receita_realizada / o.receita_orcada >= 0.9 THEN 'verde'
        WHEN r.receita_realizada / o.receita_orcada >= 0.7 THEN 'amarelo' ELSE 'vermelho' END
    ) ORDER BY r.linha_nome), '[]'::jsonb),
    SUM(r.receita_realizada), SUM(COALESCE(o.receita_orcada, 0))
  INTO v_linhas, v_total_realizado, v_total_orcado
  FROM realizado r LEFT JOIN orcado o ON o.linha_id = r.linha_id;

  -- Receita total do mês (competência, ROB) — pra achar o NÃO classificado.
  SELECT COALESCE(SUM(pd.valor), 0) INTO v_receita_total
  FROM psgc_dre pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
  WHERE pd.company_id = p_company_id AND pd.ano = v_ano AND pd.mes = v_mes
    AND pc.dre_grupo = 'ROB' AND COALESCE(pd.regime, 'competencia') = 'competencia';

  v_sem_linha := v_receita_total - COALESCE(v_total_realizado, 0);
  IF v_sem_linha > 0.005 THEN
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'linha_id', 'sem_linha', 'linha_nome', 'Sem linha de negócio',
      'realizado', v_sem_linha, 'orcado', 0, 'pct_atingido', NULL, 'status', 'sem_orcamento'));
    v_total_realizado := COALESCE(v_total_realizado, 0) + v_sem_linha;
  END IF;

  v_pct_geral := CASE WHEN COALESCE(v_total_orcado, 0) = 0 THEN NULL
                       ELSE ROUND((v_total_realizado / v_total_orcado) * 100, 0) END;

  RETURN jsonb_build_object(
    'company_id', p_company_id, 'mes', v_mes, 'ano', v_ano, 'linhas', v_linhas,
    'total_realizado', COALESCE(v_total_realizado, 0), 'total_orcado', COALESCE(v_total_orcado, 0),
    'pct_geral', v_pct_geral);
END; $function$;
