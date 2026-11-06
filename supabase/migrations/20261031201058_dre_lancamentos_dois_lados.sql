-- DRE · detalhe da linha tem de bater SEMPRE com o DRE (CEO 28/10) · Parte 1 — fonte única nos dois lados.
-- BUG: fn_psgc_dre_lancamentos escolhia UM ramo (erp_receber se a conta é de receita, senão erp_pagar). Conta MISTA
-- (NAO_OPER/RESULT_FIN, ou qualquer conta com as duas origens no psgc_dre) perdia um lado — ex.: conta 9.2 listava só a
-- multa e acusava falsa "diferença fora do de-para". Também comparava contra a soma SEM sinal.
-- CORREÇÃO: lista os títulos de erp_pagar E de erp_receber que caem na conta, cada um com `origem` e o `valor_exibido`
-- COM O MESMO SINAL que ele tem na linha do DRE (mesma regra da fn_psgc_dre_horizontal: em NAO_OPER/RESULT_FIN o
-- recebimento entra positivo e o pagamento negativo; o grupo aplica o signo). A comparação com o DRE usa o valor COM
-- SINAL do período (psgc_dre, mesma aritmética do horizontal). RD-97: não muda o DRE (horizontal/ETL intactos).
-- CREATE OR REPLACE de função existente → revisao-eng-chefe.

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_lancamentos(p_company_ids uuid[], p_psgc_codigo text, p_mes_ini date, p_mes_fim date, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_regime     text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini        date := date_trunc('month', p_mes_ini)::date;
  v_fim        date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_grupo      text; v_conta_nome text; v_is_receita boolean; v_signo int;
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

  SELECT nome, dre_grupo INTO v_conta_nome, v_grupo FROM psgc_contas WHERE codigo = p_psgc_codigo;
  v_is_receita := COALESCE(v_grupo IN ('ROB','RECEITAS_NAO_OP'), false);
  -- signo da linha no DRE: receita (+), todo o resto (−) — espelha a gmap da fn_psgc_dre_horizontal
  v_signo := CASE WHEN v_is_receita THEN 1 ELSE -1 END;

  WITH tit AS (
    -- A PAGAR (todo grupo que não é de receita)
    SELECT 'a pagar'::text AS origem, p.id, p.company_id,
           COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(p.descricao),'') AS descricao, NULLIF(btrim(p.numero_documento),'') AS documento,
           p.data_competencia, p.data_vencimento, p.data_pagamento, COALESCE(p.valor,0) AS valor, p.status,
           (CASE WHEN v_regime='caixa' THEN p.data_pagamento
                 WHEN v_regime='previsto' THEN p.data_vencimento
                 ELSE COALESCE(p.data_competencia, p.data_emissao) END)::date AS data_regime,
           v_signo * COALESCE(p.valor,0) AS valor_exibido
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
    UNION ALL
    -- A RECEBER (grupos de receita + não-operacional/financeiro, onde há recebimento)
    SELECT 'a receber'::text AS origem, r.id, r.company_id,
           COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(r.descricao),'') AS descricao, NULLIF(btrim(r.numero_documento),'') AS documento,
           r.data_competencia, r.data_vencimento, r.data_pagamento, COALESCE(r.valor,0) AS valor, r.status,
           (CASE WHEN v_regime='caixa' THEN r.data_pagamento
                 WHEN v_regime='previsto' THEN r.data_vencimento
                 ELSE COALESCE(r.data_competencia, r.data_emissao) END)::date AS data_regime,
           v_signo * (CASE WHEN v_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END) * COALESCE(r.valor,0) AS valor_exibido
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
           'id', id, 'empresa_id', company_id, 'origem', origem, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
           'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
           'valor', round(valor,2), 'valor_exibido', round(valor_exibido,2), 'status', status, 'sem_competencia', (data_competencia IS NULL)
         ) ORDER BY data_regime, valor_exibido),
         round(COALESCE(SUM(valor_exibido),0),2)
    INTO v_lanc, v_total FROM tit;

  -- órfãos: títulos da conta (dos dois lados) sem competência e sem emissão, que caem no período por vencimento/pagamento
  WITH orf AS (
    SELECT 'a pagar'::text AS origem, p.id, p.company_id, COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(p.descricao),'') AS descricao, NULLIF(btrim(p.numero_documento),'') AS documento,
           p.data_competencia, p.data_vencimento, p.data_pagamento, COALESCE(p.valor,0) AS valor, p.status,
           v_signo * COALESCE(p.valor,0) AS valor_exibido, COALESCE(p.data_vencimento, p.data_pagamento) AS ord
    FROM erp_pagar p
    JOIN LATERAL (SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1) best ON best.psgc_codigo = p_psgc_codigo
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND COALESCE(p.data_competencia, p.data_emissao) IS NULL AND COALESCE(p.data_vencimento, p.data_pagamento) BETWEEN v_ini AND v_fim
    UNION ALL
    SELECT 'a receber'::text AS origem, r.id, r.company_id, COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)') AS pessoa,
           NULLIF(btrim(r.descricao),'') AS descricao, NULLIF(btrim(r.numero_documento),'') AS documento,
           r.data_competencia, r.data_vencimento, r.data_pagamento, COALESCE(r.valor,0) AS valor, r.status,
           v_signo * (CASE WHEN v_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END) * COALESCE(r.valor,0) AS valor_exibido,
           COALESCE(r.data_vencimento, r.data_pagamento) AS ord
    FROM erp_receber r
    JOIN LATERAL (SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1) best ON best.psgc_codigo = p_psgc_codigo
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL AND (r.status IS NULL OR r.status <> 'cancelado')
      AND COALESCE(r.data_competencia, r.data_emissao) IS NULL AND COALESCE(r.data_vencimento, r.data_pagamento) BETWEEN v_ini AND v_fim
  )
  SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'empresa_id', company_id, 'origem', origem, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
           'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
           'valor', round(valor,2), 'valor_exibido', round(valor_exibido,2), 'status', status, 'sem_competencia', true
         ) ORDER BY ord) INTO v_orfaos FROM orf;

  -- valor da linha no período COM SINAL, da mesma forma que a fn_psgc_dre_horizontal (reconciliação com o DRE)
  SELECT round(v_signo * COALESCE(SUM(CASE WHEN d.source ILIKE '%receber%' AND v_grupo IN ('NAO_OPER','RESULT_FIN') THEN -d.valor ELSE d.valor END),0),2)
    INTO v_dre_periodo
  FROM psgc_dre d
  WHERE d.company_id = ANY(p_company_ids) AND d.psgc_codigo = p_psgc_codigo
    AND COALESCE(d.regime,'competencia') = v_regime
    AND make_date(d.ano, d.mes, 1) BETWEEN v_ini AND date_trunc('month', v_fim)::date;

  RETURN jsonb_build_object(
    'ok', true,
    'conta_codigo', p_psgc_codigo, 'conta_nome', v_conta_nome, 'dre_grupo', v_grupo,
    'is_receita', v_is_receita, 'fonte', 'erp_pagar + erp_receber',
    'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'total', COALESCE(v_total,0), 'dre_periodo', v_dre_periodo,
    'diferenca', round(COALESCE(v_total,0) - COALESCE(v_dre_periodo,0),2),
    'lancamentos', COALESCE(v_lanc, '[]'::jsonb),
    'orfaos', COALESCE(v_orfaos, '[]'::jsonb)
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_lancamentos(uuid[], text, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_lancamentos(uuid[], text, date, date, text) TO authenticated;
