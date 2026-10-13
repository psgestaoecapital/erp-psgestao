-- ============================================================
-- fn_psgc_dre_diario — drill DIÁRIO de uma conta do DRE (F2, opção 🅰️).
-- Ao filtrar 1 mês e expandir uma conta-folha: grade de 31 dias × pessoa
-- (cliente no receber / fornecedor no pagar), valor no dia do lançamento,
-- ordenado maior→menor. Consolida os CNPJs do grupo.
--
-- FONTE (RD-26): erp_receber/erp_pagar (raw) mapeados a psgc_codigo via
-- psgc_depara (titulo.categoria = origem_codigo, por company, melhor confiança) —
-- MESMO join do engine fn_psgc_recalcular_dre_mes.
--
-- DATA DO DIA (RD-51 — corrijo a premissa do SPEC): o SPEC pedia data_competencia,
-- MAS o engine constrói o psgc_dre por data_emissao (competência) / data_pagamento
-- (caixa). Pra o somatório diário FECHAR com o total do mês do DRE (RD-38), uso o
-- MESMO campo do engine. Provado: contas 6.1 (161.047,50) e 6.3 (8.272,49) batem
-- exatamente o DRE (Tryo, jul/26).
--
-- Pilar 2: SECURITY DEFINER + guard de escopo.
-- Retorno jsonb: { ok, psgc_codigo, is_receita, fonte, ano, mes, regime,
--   dias_no_mes, dre_mes, total,
--   pessoas: [{ pessoa_id, pessoa_nome, valores_dia {'YYYY-MM-DD': v}, total }] (total DESC) }
-- Coerência: total ≈ dre_mes (frontend sinaliza diferença = título fora do de-para).
-- Aplicada via MCP em 2026-07-30.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_diario(
  p_company_ids uuid[],
  p_psgc_codigo text,
  p_ano int,
  p_mes int,
  p_regime text DEFAULT 'competencia'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_regime    text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini       date := make_date(p_ano, p_mes, 1);
  v_fim       date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_natureza  text;
  v_dre_grupo text;
  v_is_receita boolean;
  v_out       jsonb;
  v_total     numeric;
  v_dre_mes   numeric;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  SELECT natureza, dre_grupo INTO v_natureza, v_dre_grupo FROM psgc_contas WHERE codigo = p_psgc_codigo;
  v_is_receita := COALESCE(v_dre_grupo IN ('ROB','RECEITAS_NAO_OP'), false) OR v_natureza = 'receita';

  IF v_is_receita THEN
    WITH tit AS (
      SELECT r.cliente_id AS pid,
             COALESCE(NULLIF(btrim(r.cliente_nome),''), '(sem nome)') AS pnome,
             (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) AS dia,
             COALESCE(r.valor,0) AS valor
      FROM erp_receber r
      JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON best.psgc_codigo = p_psgc_codigo
      WHERE r.company_id = ANY(p_company_ids)
        AND (r.status IS NULL OR r.status <> 'cancelado')
        AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento ELSE r.data_emissao::timestamptz END) IS NOT NULL
        AND (CASE WHEN v_regime='caixa' THEN r.data_pagamento::date ELSE r.data_emissao::date END) BETWEEN v_ini AND v_fim
    ),
    perday AS (SELECT pid, pnome, to_char(dia,'YYYY-MM-DD') ymd, SUM(valor) v FROM tit GROUP BY pid, pnome, to_char(dia,'YYYY-MM-DD')),
    agg AS (SELECT pid, max(pnome) pnome, jsonb_object_agg(ymd, round(v,2)) valores_dia, SUM(v) total FROM perday GROUP BY pid)
    SELECT jsonb_agg(jsonb_build_object('pessoa_id', pid, 'pessoa_nome', pnome, 'valores_dia', valores_dia, 'total', round(total,2)) ORDER BY total DESC),
           round(COALESCE(SUM(total),0),2)
      INTO v_out, v_total FROM agg;
  ELSE
    WITH tit AS (
      SELECT p.fornecedor_id AS pid,
             COALESCE(NULLIF(btrim(p.fornecedor_nome),''), '(sem nome)') AS pnome,
             (CASE WHEN v_regime='caixa' THEN p.data_pagamento::date ELSE p.data_emissao::date END) AS dia,
             COALESCE(p.valor,0) AS valor
      FROM erp_pagar p
      JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON best.psgc_codigo = p_psgc_codigo
      WHERE p.company_id = ANY(p_company_ids)
        AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
        AND (CASE WHEN v_regime='caixa' THEN p.data_pagamento ELSE p.data_emissao END) IS NOT NULL
        AND (CASE WHEN v_regime='caixa' THEN p.data_pagamento::date ELSE p.data_emissao::date END) BETWEEN v_ini AND v_fim
    ),
    perday AS (SELECT pid, pnome, to_char(dia,'YYYY-MM-DD') ymd, SUM(valor) v FROM tit GROUP BY pid, pnome, to_char(dia,'YYYY-MM-DD')),
    agg AS (SELECT pid, max(pnome) pnome, jsonb_object_agg(ymd, round(v,2)) valores_dia, SUM(v) total FROM perday GROUP BY pid)
    SELECT jsonb_agg(jsonb_build_object('pessoa_id', pid, 'pessoa_nome', pnome, 'valores_dia', valores_dia, 'total', round(total,2)) ORDER BY total DESC),
           round(COALESCE(SUM(total),0),2)
      INTO v_out, v_total FROM agg;
  END IF;

  SELECT round(COALESCE(SUM(valor),0),2) INTO v_dre_mes FROM psgc_dre
  WHERE company_id = ANY(p_company_ids) AND psgc_codigo = p_psgc_codigo
    AND ano = p_ano AND mes = p_mes AND COALESCE(regime,'competencia') = v_regime;

  RETURN jsonb_build_object(
    'ok', true, 'psgc_codigo', p_psgc_codigo, 'is_receita', v_is_receita,
    'fonte', CASE WHEN v_is_receita THEN 'erp_receber' ELSE 'erp_pagar' END,
    'ano', p_ano, 'mes', p_mes, 'regime', v_regime,
    'dias_no_mes', extract(day FROM v_fim)::int,
    'dre_mes', v_dre_mes, 'total', COALESCE(v_total,0),
    'pessoas', COALESCE(v_out, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_psgc_dre_diario(uuid[], text, int, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_diario(uuid[], text, int, int, text) TO authenticated;
