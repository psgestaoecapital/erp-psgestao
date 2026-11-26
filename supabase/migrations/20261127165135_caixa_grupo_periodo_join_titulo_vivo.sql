-- /dashboard/financeiro/caixa-grupo · RD-38 · NÚCLEO
-- CORRETUDE (produção): fn_caixa_grupo_periodo contava baixa de título SOFT-DELETADO como
-- "Recebido/Pago no período" (cards "Recebidos no período" / "Pagos no período" / "Resultado
-- do período"). As CTEs rb/pb somavam erp_receber_baixa / erp_pagar_baixa SEM juntar o título
-- PAI, então uma baixa cujo título foi excluído (ou virou cancelado/renegociado) seguia contando
-- como caixa realizado (recebimento/pagamento fantasma). Mesma classe de bug do fn_fluxo_caixa_diario
-- (#5836) e irmã listada no sweep da tarefa 13e57368.
--
-- RD-38 — PROVA NO DADO (DEMO Comércio GE b0700000-…-004, período 11/10→25/11):
--   pago_bruto  ATUAL R$ 5.436.990,62  → CORRIGIDO R$ 25.375,16  (bate com o fn_fluxo_caixa_diario já corrigido)
--   receb_bruto ATUAL R$   325.000,00  → CORRIGIDO R$      0,00  (bate com o extrato já corrigido, #5760)
-- Empresas REAIS afetadas: as mesmas baixas órfãs documentadas em #5836 (lado pagar: b26c19c0,
-- d577602d, 636af107; lado receber: a462e13f, 36b69d77) — magnitude pequena hoje, mas é corretude
-- num indicador financeiro central e cresce a cada título excluído.
--
-- CORREÇÃO (cirúrgica, idempotente): juntar o título pai e filtrar deleted_at + status, igual ao #5836.
-- As demais CTEs (ar/ap, a receber/a pagar em aberto) já leem o título direto com deleted_at IS NULL — OK.
-- fn_caixa_grupo_dia é SEGURA (monta os lançamentos por rtit/ptit, que já filtram er/ep.deleted_at IS NULL).

CREATE OR REPLACE FUNCTION public.fn_caixa_grupo_periodo(p_company_ids uuid[], p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_empresas jsonb;
  v_cons jsonb;
BEGIN
  -- Fail-closed por empresa: sem JWT = chamada interna; service_role passa; logado só vê as suas (RLS).
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN
    v_ids := p_company_ids;
  ELSE
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'por_empresa', '[]'::jsonb,
      'consolidado', jsonb_build_object('recebido_bruto',0,'pago_bruto',0,'a_receber_aberto',0,'a_pagar_aberto',0));
  END IF;

  WITH rb AS (  -- recebido BRUTO do período por empresa = soma das baixas de receber (p_ini → p_fim)
    -- Junta o título PAI e filtra deleted_at/status: baixa de título soft-deletado (ou cancelado/
    -- renegociado) NÃO é caixa realizado (fantasma). Mesma correção do fn_fluxo_caixa_diario (#5836).
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_receber_baixa b
      JOIN erp_receber er ON er.id = b.receber_id
     WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim
       AND er.deleted_at IS NULL AND er.status NOT IN ('cancelado','renegociado')
     GROUP BY b.company_id
  ),
  pb AS (  -- pago BRUTO do período por empresa = soma das baixas de pagar (p_ini → p_fim)
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_pagar_baixa b
      JOIN erp_pagar ep ON ep.id = b.pagar_id
     WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim
       AND ep.deleted_at IS NULL AND ep.status <> 'cancelado'
     GROUP BY b.company_id
  ),
  ar AS (  -- a receber em aberto na data final (mesmo predicado do fn_caixa_grupo_dia · vence), por empresa
    SELECT er.company_id AS cid, COALESCE(SUM(GREATEST(er.valor - COALESCE(er.valor_pago,0),0)),0) AS v
      FROM erp_receber er
     WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
       AND er.status NOT IN ('cancelado','recebido','pago')
       AND GREATEST(er.valor - COALESCE(er.valor_pago,0),0) > 0.005
       AND er.data_vencimento <= p_fim + 7
     GROUP BY er.company_id
  ),
  ap AS (  -- a pagar em aberto na data final (mesmo predicado do fn_caixa_grupo_dia · vence), por empresa
    SELECT ep.company_id AS cid, COALESCE(SUM(GREATEST(ep.valor - COALESCE(ep.valor_pago,0),0)),0) AS v
      FROM erp_pagar ep
     WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
       AND ep.status NOT IN ('cancelado','pago')
       AND GREATEST(ep.valor - COALESCE(ep.valor_pago,0),0) > 0.005
       AND ep.data_vencimento <= p_fim + 7
     GROUP BY ep.company_id
  ),
  ef AS (  -- todas as empresas do grupo viram linha (mesmo sem movimento), igual às outras
    SELECT co.id AS cid, coalesce(co.nome_fantasia, co.razao_social) AS nome,
           round(COALESCE(rb.v,0),2) AS recebido_bruto, round(COALESCE(pb.v,0),2) AS pago_bruto,
           round(COALESCE(ar.v,0),2) AS a_receber_aberto, round(COALESCE(ap.v,0),2) AS a_pagar_aberto
      FROM unnest(v_ids) AS vid
      JOIN companies co ON co.id = vid
      LEFT JOIN rb ON rb.cid = vid LEFT JOIN pb ON pb.cid = vid
      LEFT JOIN ar ON ar.cid = vid LEFT JOIN ap ON ap.cid = vid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'company_id', ef.cid, 'nome', ef.nome,
      'recebido_bruto', ef.recebido_bruto, 'pago_bruto', ef.pago_bruto,
      'a_receber_aberto', ef.a_receber_aberto, 'a_pagar_aberto', ef.a_pagar_aberto) ORDER BY ef.nome), '[]'::jsonb),
    jsonb_build_object(
      'recebido_bruto', round(COALESCE(SUM(ef.recebido_bruto),0),2),
      'pago_bruto', round(COALESCE(SUM(ef.pago_bruto),0),2),
      'a_receber_aberto', round(COALESCE(SUM(ef.a_receber_aberto),0),2),
      'a_pagar_aberto', round(COALESCE(SUM(ef.a_pagar_aberto),0),2))
  INTO v_empresas, v_cons
  FROM ef;

  RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'por_empresa', v_empresas, 'consolidado', v_cons);
END;
$function$;
