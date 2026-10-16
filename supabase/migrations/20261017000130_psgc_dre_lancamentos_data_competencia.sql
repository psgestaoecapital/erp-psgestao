-- DRE drill 3º nível — CORREÇÃO da regra de data (CEO 14/10): o detalhe tem de usar EXATAMENTE a mesma regra do motor
-- do DRE (fn_psgc_recalcular_dre_mes), senão não fecha. O recálculo usa COALESCE(data_competencia, data_emissao) para
-- COMPETÊNCIA (não data_emissao sozinha). Caixa = data_pagamento; previsto = data_vencimento (inalterados).
--
-- Prova (Umuarama, conta 0.3 Distribuição de Resultado aos Sócios): retiradas com competência 15/12/2025 e 17/07/2026 e
-- emissão 16/09/2026 aparecem em dez/25 e jul/26 (por COALESCE), e o somatório fecha centavo a centavo com o psgc_dre
-- em cada mês (dez/25=100k, mar/26=50k, jun/26=100k, jul/26=300k); set/26 = R$ 0. Com data_emissao sozinha (bug do
-- #2592) elas cairiam todas em set/26 e o detalhe não fechava.
--
-- CREATE OR REPLACE da MESMA função (financeiro) — via revisada. Só leitura, mesma guarda das fn_psgc_dre_*.

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_lancamentos(
  p_company_ids uuid[],
  p_psgc_codigo text,
  p_mes_ini date,
  p_mes_fim date,
  p_regime text DEFAULT 'competencia'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_regime     text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini        date := date_trunc('month', p_mes_ini)::date;
  v_fim        date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_natureza   text; v_dre_grupo text; v_conta_nome text; v_is_receita boolean;
  v_lanc jsonb; v_orfaos jsonb; v_total numeric; v_dre_periodo numeric;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  SELECT nome, natureza, dre_grupo INTO v_conta_nome, v_natureza, v_dre_grupo
  FROM psgc_contas WHERE codigo = p_psgc_codigo;
  v_is_receita := COALESCE(v_dre_grupo IN ('ROB','RECEITAS_NAO_OP'), false) OR v_natureza = 'receita';

  IF v_is_receita THEN
    WITH tit AS (
      SELECT r.id, r.company_id,
             COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)') AS pessoa,
             NULLIF(btrim(r.descricao),'')       AS descricao,
             NULLIF(btrim(r.numero_documento),'') AS documento,
             r.data_competencia, r.data_vencimento, r.data_pagamento,
             COALESCE(r.valor,0) AS valor, r.status,
             (CASE WHEN v_regime='caixa' THEN r.data_pagamento
                   WHEN v_regime='previsto' THEN r.data_vencimento
                   ELSE COALESCE(r.data_competencia, r.data_emissao) END)::date AS data_regime
      FROM erp_receber r
      JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON best.psgc_codigo = p_psgc_codigo
      WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL
        AND (r.status IS NULL OR r.status <> 'cancelado')
        AND CASE
          WHEN v_regime='caixa'    THEN r.data_pagamento IS NOT NULL AND r.data_pagamento BETWEEN v_ini AND v_fim
                                        AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
          WHEN v_regime='previsto' THEN r.data_vencimento IS NOT NULL AND r.data_vencimento BETWEEN v_ini AND v_fim
                                        AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado')
          ELSE COALESCE(r.data_competencia, r.data_emissao) IS NOT NULL
               AND COALESCE(r.data_competencia, r.data_emissao) BETWEEN v_ini AND v_fim
               AND NOT COALESCE(r.eh_repasse_cartao,false)
        END
    )
    SELECT jsonb_agg(jsonb_build_object(
             'id', id, 'empresa_id', company_id, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
             'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
             'valor', round(valor,2), 'status', status, 'sem_competencia', (data_competencia IS NULL)
           ) ORDER BY data_regime, valor DESC),
           round(COALESCE(SUM(valor),0),2)
      INTO v_lanc, v_total FROM tit;

    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'empresa_id', r.company_id,
             'pessoa', COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)'),
             'descricao', NULLIF(btrim(r.descricao),''), 'documento', NULLIF(btrim(r.numero_documento),''),
             'data_competencia', r.data_competencia, 'data_vencimento', r.data_vencimento, 'data_pagamento', r.data_pagamento,
             'valor', round(COALESCE(r.valor,0),2), 'status', r.status, 'sem_competencia', true)
           ORDER BY COALESCE(r.data_vencimento, r.data_pagamento))
      INTO v_orfaos
    FROM erp_receber r
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = p_psgc_codigo
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL
      AND (r.status IS NULL OR r.status <> 'cancelado')
      AND COALESCE(r.data_competencia, r.data_emissao) IS NULL
      AND COALESCE(r.data_vencimento, r.data_pagamento) BETWEEN v_ini AND v_fim;
  ELSE
    WITH tit AS (
      SELECT p.id, p.company_id,
             COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)') AS pessoa,
             NULLIF(btrim(p.descricao),'')       AS descricao,
             NULLIF(btrim(p.numero_documento),'') AS documento,
             p.data_competencia, p.data_vencimento, p.data_pagamento,
             COALESCE(p.valor,0) AS valor, p.status,
             (CASE WHEN v_regime='caixa' THEN p.data_pagamento
                   WHEN v_regime='previsto' THEN p.data_vencimento
                   ELSE COALESCE(p.data_competencia, p.data_emissao) END)::date AS data_regime
      FROM erp_pagar p
      JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON best.psgc_codigo = p_psgc_codigo
      WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
        AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
        AND CASE
          WHEN v_regime='caixa'    THEN p.data_pagamento IS NOT NULL AND p.data_pagamento BETWEEN v_ini AND v_fim
          WHEN v_regime='previsto' THEN p.data_vencimento IS NOT NULL AND p.data_vencimento BETWEEN v_ini AND v_fim
                                        AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
          ELSE COALESCE(p.data_competencia, p.data_emissao) IS NOT NULL
               AND COALESCE(p.data_competencia, p.data_emissao) BETWEEN v_ini AND v_fim
        END
    )
    SELECT jsonb_agg(jsonb_build_object(
             'id', id, 'empresa_id', company_id, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
             'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
             'valor', round(valor,2), 'status', status, 'sem_competencia', (data_competencia IS NULL)
           ) ORDER BY data_regime, valor DESC),
           round(COALESCE(SUM(valor),0),2)
      INTO v_lanc, v_total FROM tit;

    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'empresa_id', p.company_id,
             'pessoa', COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)'),
             'descricao', NULLIF(btrim(p.descricao),''), 'documento', NULLIF(btrim(p.numero_documento),''),
             'data_competencia', p.data_competencia, 'data_vencimento', p.data_vencimento, 'data_pagamento', p.data_pagamento,
             'valor', round(COALESCE(p.valor,0),2), 'status', p.status, 'sem_competencia', true)
           ORDER BY COALESCE(p.data_vencimento, p.data_pagamento))
      INTO v_orfaos
    FROM erp_pagar p
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = p_psgc_codigo
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND COALESCE(p.data_competencia, p.data_emissao) IS NULL
      AND COALESCE(p.data_vencimento, p.data_pagamento) BETWEEN v_ini AND v_fim;
  END IF;

  -- valor da conta no período direto do psgc_dre (mesma fonte das 15 linhas) → reconciliação centavo a centavo.
  SELECT round(COALESCE(SUM(valor),0),2) INTO v_dre_periodo
  FROM psgc_dre
  WHERE company_id = ANY(p_company_ids) AND psgc_codigo = p_psgc_codigo
    AND COALESCE(regime,'competencia') = v_regime
    AND make_date(ano, mes, 1) BETWEEN v_ini AND date_trunc('month', v_fim)::date;

  RETURN jsonb_build_object(
    'ok', true,
    'conta_codigo', p_psgc_codigo, 'conta_nome', v_conta_nome,
    'is_receita', v_is_receita, 'fonte', CASE WHEN v_is_receita THEN 'erp_receber' ELSE 'erp_pagar' END,
    'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'total', COALESCE(v_total,0), 'dre_periodo', v_dre_periodo,
    'lancamentos', COALESCE(v_lanc, '[]'::jsonb),
    'orfaos', COALESCE(v_orfaos, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_psgc_dre_lancamentos(uuid[], text, date, date, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_lancamentos(uuid[], text, date, date, text) TO authenticated, service_role;
