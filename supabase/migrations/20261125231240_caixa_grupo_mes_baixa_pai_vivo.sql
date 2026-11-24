-- GAPS GE · /dashboard/financeiro/caixa-grupo (complemento da #5868)
-- CORRECTNESS NÚCLEO: fn_caixa_grupo_mes conta baixa de título-pai SOFT-DELETADO.
--
-- RAIZ (RD-38, provado em produção, DEMO GE b0700000-...-0004):
--   Os CTEs rb (recebido bruto do mês) e pb (pago bruto do mês) somavam
--   erp_receber_baixa / erp_pagar_baixa filtrando apenas b.deleted_at IS NULL,
--   SEM conferir se o TÍTULO-PAI (erp_receber / erp_pagar) está soft-deletado.
--   Quando um título pago é cancelado/soft-deletado (ex.: purga durável #5747),
--   suas baixas permanecem vivas → inflavam recebido_mes_bruto / pago_mes_bruto.
--   Prova DEMO GE: 1.443 receber_baixa (R$ 116.566,00) e 21.459 pagar_baixa
--   (R$ 7.035.138,30) tinham deleted_at IS NULL mas o título-pai estava
--   soft-deletado — todo esse valor era fantasma no "recebido/pago do mês".
--
--   A função-irmã fn_caixa_grupo_dia JÁ exclui (seus CTEs rtit/ptit exigem
--   er.deleted_at IS NULL / ep.deleted_at IS NULL e só então casam a baixa);
--   fn_caixa_grupo_mes ficou para trás.
--
-- CORREÇÃO (mínima, espelha a irmã _dia): em rb/pb, JOIN ao título-pai exigindo
--   t.deleted_at IS NULL. Nenhuma outra linha da função muda. Aditiva, leitura,
--   não toca estrutura nem dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_caixa_grupo_mes(p_company_ids uuid[], p_data date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_ini date := date_trunc('month', p_data)::date;
  v_empresas jsonb;
  v_cons jsonb;
BEGIN
  -- Fail-closed por empresa: sem JWT = chamada interna; service_role passa; logado só vê as suas (RLS).
  -- (mesma trava do fn_caixa_grupo_dia)
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN
    v_ids := p_company_ids;
  ELSE
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'data', p_data, 'mes_inicio', v_ini, 'por_empresa', '[]'::jsonb,
      'consolidado', jsonb_build_object('recebido_mes_bruto',0,'pago_mes_bruto',0,'a_receber_aberto',0,'a_pagar_aberto',0));
  END IF;

  WITH rb AS (  -- recebido BRUTO do mês por empresa = soma das baixas de receber (dia 1 → data), só de título VIVO
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_receber_baixa b
      JOIN erp_receber t ON t.id = b.receber_id AND t.deleted_at IS NULL
     WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN v_ini AND p_data
     GROUP BY b.company_id
  ),
  pb AS (  -- pago BRUTO do mês por empresa = soma das baixas de pagar (dia 1 → data), só de título VIVO
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_pagar_baixa b
      JOIN erp_pagar t ON t.id = b.pagar_id AND t.deleted_at IS NULL
     WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN v_ini AND p_data
     GROUP BY b.company_id
  ),
  ar AS (  -- a receber em aberto (mesmo predicado do fn_caixa_grupo_dia · vence), por empresa
    SELECT er.company_id AS cid, COALESCE(SUM(GREATEST(er.valor - COALESCE(er.valor_pago,0),0)),0) AS v
      FROM erp_receber er
     WHERE er.company_id = ANY(v_ids) AND er.deleted_at IS NULL
       AND er.status NOT IN ('cancelado','recebido','pago')
       AND GREATEST(er.valor - COALESCE(er.valor_pago,0),0) > 0.005
       AND er.data_vencimento <= p_data + 7
     GROUP BY er.company_id
  ),
  ap AS (  -- a pagar em aberto (mesmo predicado do fn_caixa_grupo_dia · vence), por empresa
    SELECT ep.company_id AS cid, COALESCE(SUM(GREATEST(ep.valor - COALESCE(ep.valor_pago,0),0)),0) AS v
      FROM erp_pagar ep
     WHERE ep.company_id = ANY(v_ids) AND ep.deleted_at IS NULL
       AND ep.status NOT IN ('cancelado','pago')
       AND GREATEST(ep.valor - COALESCE(ep.valor_pago,0),0) > 0.005
       AND ep.data_vencimento <= p_data + 7
     GROUP BY ep.company_id
  ),
  ef AS (  -- todas as empresas do grupo viram linha (mesmo sem movimento), igual ao _dia
    SELECT co.id AS cid, coalesce(co.nome_fantasia, co.razao_social) AS nome,
           round(COALESCE(rb.v,0),2) AS recebido_mes_bruto, round(COALESCE(pb.v,0),2) AS pago_mes_bruto,
           round(COALESCE(ar.v,0),2) AS a_receber_aberto, round(COALESCE(ap.v,0),2) AS a_pagar_aberto
      FROM unnest(v_ids) AS vid
      JOIN companies co ON co.id = vid
      LEFT JOIN rb ON rb.cid = vid LEFT JOIN pb ON pb.cid = vid
      LEFT JOIN ar ON ar.cid = vid LEFT JOIN ap ON ap.cid = vid
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'company_id', ef.cid, 'nome', ef.nome,
      'recebido_mes_bruto', ef.recebido_mes_bruto, 'pago_mes_bruto', ef.pago_mes_bruto,
      'a_receber_aberto', ef.a_receber_aberto, 'a_pagar_aberto', ef.a_pagar_aberto) ORDER BY ef.nome), '[]'::jsonb),
    jsonb_build_object(
      'recebido_mes_bruto', round(COALESCE(SUM(ef.recebido_mes_bruto),0),2),
      'pago_mes_bruto', round(COALESCE(SUM(ef.pago_mes_bruto),0),2),
      'a_receber_aberto', round(COALESCE(SUM(ef.a_receber_aberto),0),2),
      'a_pagar_aberto', round(COALESCE(SUM(ef.a_pagar_aberto),0),2))
  INTO v_empresas, v_cons
  FROM ef;

  RETURN jsonb_build_object('ok', true, 'data', p_data, 'mes_inicio', v_ini,
    'por_empresa', v_empresas, 'consolidado', v_cons);
END;
$function$;


-- Guarda de acesso (check_fn_guards · [revoke_anon]): CREATE OR REPLACE não mexe
-- nos grants; o bloco só reafirma a ACL VIVA (authenticated + service_role),
-- sem ampliar acesso.
REVOKE ALL ON FUNCTION public.fn_caixa_grupo_mes(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_caixa_grupo_mes(uuid[], date) TO authenticated, service_role;
