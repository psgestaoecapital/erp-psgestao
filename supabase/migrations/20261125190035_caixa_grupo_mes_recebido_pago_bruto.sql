-- Caixa do grupo · Recebidos e Pagos BRUTOS do mês (dia 1 → data) — Pdois/Julia (Financeiro).
-- Função NOVA aditiva de leitura (não troca a fn_caixa_grupo_dia, usada por outras telas). Soma das BAIXAS
-- (tudo que entrou/saiu da conta), sem líquido. A receber/a pagar em aberto usam o MESMO predicado do
-- fn_caixa_grupo_dia (status + saldo remanescente + vencimento ≤ data+7), por empresa, para bater com os
-- cartões consolidados que a tela já mostra (não recalcular diferente). Mesma trava fail-closed/RLS do _dia.
-- SECURITY DEFINER, STABLE, REVOKE anon.

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

  WITH rb AS (  -- recebido BRUTO do mês por empresa = soma das baixas de receber (dia 1 → data)
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_receber_baixa b
     WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN v_ini AND p_data
     GROUP BY b.company_id
  ),
  pb AS (  -- pago BRUTO do mês por empresa = soma das baixas de pagar (dia 1 → data)
    SELECT b.company_id AS cid, COALESCE(SUM(b.valor),0) AS v
      FROM erp_pagar_baixa b
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

REVOKE ALL ON FUNCTION public.fn_caixa_grupo_mes(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_caixa_grupo_mes(uuid[], date) TO authenticated, service_role;

-- RD-95: "?" dos indicadores novos (linguagem da Julia).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('financeiro.caixa_grupo.recebido_mes', '/dashboard/financeiro/caixa-grupo', 'Indicadores', 'Recebidos (mês)',
  'Soma de tudo que ENTROU na conta do dia 1 do mês até a data escolhida — valor bruto, sem descontar nada.',
  'Serve para conferir com o seu outro sistema e migrar a operação para o PS: é o total bruto recebido no mês.',
  'Do dia 1 até 23/11: R$ 90.020,05 recebidos.', 'Comparar com o líquido (aqui é bruto: a soma das baixas).',
  'gestao_empresarial', 20, 1, 'publicado'),
 ('financeiro.caixa_grupo.pago_mes', '/dashboard/financeiro/caixa-grupo', 'Indicadores', 'Pagos (mês)',
  'Soma de tudo que SAIU da conta do dia 1 do mês até a data escolhida — valor bruto, sem descontar nada.',
  'Serve para conferir com o seu outro sistema: é o total bruto pago no mês.',
  'Do dia 1 até 23/11: R$ 45.300,00 pagos.', 'Comparar com o líquido (aqui é bruto: a soma das baixas).',
  'gestao_empresarial', 21, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
