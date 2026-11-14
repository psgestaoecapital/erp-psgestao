-- DRE · "Saúde do DRE" (Parte 3, CEO 28/10) — o DRE Consolidado mostra, de uma vez, se o detalhe de CADA conta
-- bate com a linha do DRE (⚠ na linha que não bate) e um indicador no topo (quantas contas conciliam).
-- Reaproveita a MESMA aritmética já provada e mergeada na Parte 1 (fn_psgc_dre_lancamentos, #3423): lista os
-- títulos de erp_pagar E erp_receber que caem em cada conta via de-para, com o MESMO SINAL da linha do DRE, e
-- compara com o valor COM SINAL do período (psgc_dre). A diferença por conta = total do detalhe − linha do DRE.
-- Aqui a conta não é fixa: cada título vai para a SUA melhor conta de-para e a soma é agrupada por conta — assim
-- o DRE inteiro é reconciliado numa chamada só (em vez de abrir conta por conta).
-- RD-97: NÃO altera o DRE — fn_psgc_dre_horizontal e a ETL ficam intactas. Função SÓ DE LEITURA (STABLE).
-- Nova função (aditiva), mas CONSOME o mesmo modelo financeiro → revisao-eng-chefe.

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_conciliacao(
  p_company_ids uuid[], p_mes_ini date, p_mes_fim date, p_regime text DEFAULT 'competencia'::text)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_regime text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini    date := date_trunc('month', p_mes_ini)::date;
  v_fim    date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_contas jsonb; v_resumo jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  WITH tit AS (
    -- A PAGAR: cada título vai para a sua melhor conta de-para que NÃO é de receita; valor com o sinal da linha.
    SELECT best.psgc_codigo, pc.dre_grupo AS grupo,
           (CASE WHEN pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP') THEN 1 ELSE -1 END) * COALESCE(p.valor,0) AS valor_exibido
    FROM erp_pagar p
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc2 ON pc2.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc2.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    JOIN psgc_contas pc ON pc.codigo = best.psgc_codigo
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
    -- A RECEBER: melhor conta de-para de receita/não-operacional/financeiro; recebimento em conta mista entra negativo.
    SELECT best.psgc_codigo, pc.dre_grupo,
           (CASE WHEN pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP') THEN 1 ELSE -1 END)
           * (CASE WHEN pc.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -1 ELSE 1 END) * COALESCE(r.valor,0) AS valor_exibido
    FROM erp_receber r
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc2 ON pc2.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc2.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON true
    JOIN psgc_contas pc ON pc.codigo = best.psgc_codigo
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
  ),
  det AS (
    SELECT psgc_codigo, round(SUM(valor_exibido),2) AS total_detalhe FROM tit GROUP BY psgc_codigo
  ),
  dre AS (
    SELECT d.psgc_codigo,
      round((CASE WHEN pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP') THEN 1 ELSE -1 END)
        * SUM(CASE WHEN d.source ILIKE '%receber%' AND pc.dre_grupo IN ('NAO_OPER','RESULT_FIN') THEN -d.valor ELSE d.valor END),2) AS dre_periodo
    FROM psgc_dre d JOIN psgc_contas pc ON pc.codigo = d.psgc_codigo
    WHERE d.company_id = ANY(p_company_ids) AND COALESCE(d.regime,'competencia') = v_regime
      AND make_date(d.ano, d.mes, 1) BETWEEN v_ini AND date_trunc('month', v_fim)::date
    GROUP BY d.psgc_codigo, pc.dre_grupo
  ),
  linhas AS (
    SELECT COALESCE(dre.psgc_codigo, det.psgc_codigo) AS codigo,
           pc.nome AS conta_nome, pc.dre_grupo AS grupo,
           COALESCE(pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP'), false) AS is_receita,
           round(COALESCE(det.total_detalhe,0),2) AS total_detalhe,
           round(COALESCE(dre.dre_periodo,0),2)  AS dre_periodo,
           round(COALESCE(det.total_detalhe,0) - COALESCE(dre.dre_periodo,0),2) AS diferenca
    FROM dre FULL JOIN det ON det.psgc_codigo = dre.psgc_codigo
    LEFT JOIN psgc_contas pc ON pc.codigo = COALESCE(dre.psgc_codigo, det.psgc_codigo)
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'codigo', codigo, 'conta_nome', conta_nome, 'grupo', grupo, 'is_receita', is_receita,
      'total_detalhe', total_detalhe, 'dre_periodo', dre_periodo, 'diferenca', diferenca,
      'concilia', (abs(diferenca) < 0.01)
    ) ORDER BY codigo),
    jsonb_build_object(
      'n_contas', count(*),
      'n_conciliam', count(*) FILTER (WHERE abs(diferenca) < 0.01),
      'n_diferem', count(*) FILTER (WHERE abs(diferenca) >= 0.01),
      'maior_diff_abs', COALESCE(max(abs(diferenca)),0),
      'soma_diff_abs', COALESCE(round(sum(abs(diferenca)),2),0)
    )
  INTO v_contas, v_resumo FROM linhas;

  RETURN jsonb_build_object(
    'ok', true, 'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'contas', COALESCE(v_contas, '[]'::jsonb), 'resumo', v_resumo
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_psgc_dre_conciliacao(uuid[], date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_conciliacao(uuid[], date, date, text) TO authenticated, service_role;

-- RD-95: "?" do indicador "Saúde do DRE" (aditivo; só referência em erp_ajuda_campo)
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('financeiro.dre_consolidado.saude_dre','/dashboard/financeiro/dre-consolidado','Saúde do DRE','Saúde do DRE',
   'Nada a preencher: o indicador mostra quantas contas do DRE têm o detalhe (lançamentos) batendo com a linha, no período e regime escolhidos.',
   'Dá confiança no número: quando todas as contas conciliam, o DRE reflete os lançamentos. A conta que não bate recebe um ⚠ na linha — abra o detalhe dela para ver o que falta (título sem categoria, sem a data do regime, ou DRE a recalcular).',
   'Saúde do DRE: 15 de 15 contas conciliam','Ignorar o ⚠ de uma conta: a diferença some ao corrigir a categoria do título ou recalcular o DRE, não some sozinha.','financeiro',9105,1,'publicado')
ON CONFLICT (chave) DO NOTHING;
