-- DRE: conta nova do plano sem de-para herda o vínculo da conta PAI (Eng. Chefe 07/10, Umuarama 636af107).
-- Antes: o fallback de fn_psgc_recalcular_dre_mes jogava tudo que não é investimento em 6.11 (Despesas fixas),
-- então custo da pecuária virava despesa fixa em silêncio (RD-51/RD-74).
-- Agora (ramos PAGAR direto e PAGAR caixa; Omie/lançamentos seguem INALTERADOS, RD-53):
--   1) de-para próprio  2) de-para da conta ancestral mais próxima (prefixo pontuado: 2.02.04 → 2.02 → 2)
--   3) tipo da conta: investimento → 9.3 · custo → 4.1 (CMV) · demais → 6.11 (como antes).
-- Aditivo: 2 funções novas + patch por substituição na definição VIVA (aborta se não achar os trechos).

CREATE OR REPLACE FUNCTION public.fn_psgc_depara_herdado(p_company_id uuid)
RETURNS TABLE(origem_codigo text, psgc_codigo text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (c.codigo) c.codigo, pd.psgc_codigo
  FROM erp_plano_contas c
  JOIN psgc_depara pd
    ON pd.company_id = c.company_id AND pd.ativo
   AND c.codigo LIKE pd.origem_codigo || '.%'
  JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
  WHERE c.company_id = p_company_id
    AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
    AND NOT EXISTS (SELECT 1 FROM psgc_depara x WHERE x.company_id = c.company_id AND x.origem_codigo = c.codigo AND x.ativo)
  ORDER BY c.codigo, length(pd.origem_codigo) DESC, pd.confianca DESC, pd.revisado DESC
$$;

-- Aviso da tela DRE: contas de despesa/custo/investimento do plano sem vínculo próprio (herdado ou não).
CREATE OR REPLACE FUNCTION public.fn_psgc_contas_sem_vinculo(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'qtd', count(*),
    'qtd_sem_pai_mapeado', count(*) FILTER (WHERE h.origem_codigo IS NULL),
    'contas', COALESCE(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descricao', c.descricao, 'tipo', c.tipo,
              'herdado_de', h.psgc_codigo) ORDER BY c.codigo) FILTER (WHERE c.codigo IS NOT NULL), '[]'::jsonb))
  FROM erp_plano_contas c
  LEFT JOIN fn_psgc_depara_herdado(p_company_id) h ON h.origem_codigo = c.codigo
  WHERE c.company_id = p_company_id AND c.ativo IS NOT FALSE AND COALESCE(c.is_totalizador, false) = false
    AND c.tipo IN ('despesa','custo','investimento')
    AND NOT EXISTS (SELECT 1 FROM psgc_depara x WHERE x.company_id = c.company_id AND x.origem_codigo = c.codigo AND x.ativo)
$$;

REVOKE ALL ON FUNCTION public.fn_psgc_depara_herdado(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_psgc_contas_sem_vinculo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_psgc_depara_herdado(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_psgc_contas_sem_vinculo(uuid) TO authenticated, service_role;

DO $$
DECLARE
  v_def text := pg_get_functiondef('public.fn_psgc_recalcular_dre_mes(uuid,integer,integer)'::regprocedure);
  v_ins text := E'INSERT INTO psgc_dre (company_id, ano, mes, ln_id, ln_nome, psgc_codigo, valor, qtd_lancamentos, source, regime)\n    SELECT p_company_id, p_ano, p_mes, NULL, NULL, codigo_psgc,';
  v_case text := $c$CASE WHEN epc.tipo = 'investimento' THEN COALESCE(dp.psgc_codigo, '9.3') ELSE '6.11' END$c$;
  v_join text := 'LEFT JOIN erp_plano_contas epc ON epc.company_id = p.company_id AND epc.codigo = p.categoria';
  v_novo text;
BEGIN
  IF v_def LIKE '%fn_psgc_depara_herdado%' THEN RETURN; END IF; -- já aplicado
  IF (length(v_def) - length(replace(v_def, v_ins, ''))) / length(v_ins) <> 2
     OR (length(v_def) - length(replace(v_def, v_case, ''))) / length(v_case) <> 2
     OR (length(v_def) - length(replace(v_def, v_join, ''))) / length(v_join) <> 2 THEN
    RAISE EXCEPTION 'definição viva de fn_psgc_recalcular_dre_mes mudou: trechos esperados (2x) não encontrados';
  END IF;
  v_novo := replace(v_def, v_ins, E'WITH her AS (SELECT * FROM fn_psgc_depara_herdado(p_company_id))\n    ' || v_ins);
  v_novo := replace(v_novo, v_case, $c$her.psgc_codigo,
          CASE WHEN epc.tipo = 'investimento' THEN COALESCE(dp.psgc_codigo, '9.3') WHEN epc.tipo = 'custo' THEN '4.1' ELSE '6.11' END$c$);
  v_novo := replace(v_novo, v_join, v_join || ' LEFT JOIN her ON her.origem_codigo = p.categoria');
  EXECUTE v_novo;
END $$;
