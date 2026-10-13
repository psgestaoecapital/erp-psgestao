-- RD-41 · Oficina — listagem operacional de "veículos/serviços entregues". Genérica
-- (mecânica/elétrica/tornearia): placa/veículo opcionais. Reusa entregue_em (#835) e
-- os snapshots de custo (#836). Custo [→GE] real; receita/lucro seguem a regra honesta
-- (snapshot NULL → "aguardando faturamento"). Nada financeiro novo. RLS por empresa.

CREATE OR REPLACE FUNCTION public.fn_oficina_entregues_listar(
  p_company_id uuid, p_data_ini date DEFAULT NULL, p_data_fim date DEFAULT NULL, p_busca text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_q text := NULLIF(trim(COALESCE(p_busca,'')), '');
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  WITH ent AS (
    SELECT o.id AS os_id, o.numero, o.entregue_em, o.cliente_nome, o.placa,
           NULLIF(trim(COALESCE(o.marca,'') || ' ' || COALESCE(o.modelo,'')), '') AS veiculo,
           COALESCE(NULLIF(trim(o.diagnostico), ''), NULLIF(trim(o.defeito_relatado), ''), '—') AS servico,
           o.tecnico_nome AS mecanico,
           COALESCE(o.custo_pecas_snapshot, 0) AS custo_pecas,
           COALESCE(o.custo_mao_obra_snapshot, 0) AS custo_mo,
           o.receita_snapshot AS receita, o.lucro_snapshot AS lucro,
           (o.receita_snapshot IS NULL) AS aguardando
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue' AND o.excluida_em IS NULL
      AND (p_data_ini IS NULL OR (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date >= p_data_ini)
      AND (p_data_fim IS NULL OR (o.entregue_em AT TIME ZONE 'America/Sao_Paulo')::date <= p_data_fim)
      AND (v_q IS NULL OR o.placa ILIKE '%'||v_q||'%' OR o.cliente_nome ILIKE '%'||v_q||'%' OR o.numero::text ILIKE '%'||v_q||'%')
  )
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(ent) ORDER BY ent.entregue_em DESC NULLS LAST) FROM ent), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'custo_total', COALESCE(SUM(custo_pecas + custo_mo), 0),
        'custo_pecas', COALESCE(SUM(custo_pecas), 0),
        'custo_mo', COALESCE(SUM(custo_mo), 0),
        'receita', SUM(receita),                       -- NULL enquanto nenhuma faturada
        'lucro', SUM(lucro),
        'qtd_aguardando', COUNT(*) FILTER (WHERE aguardando)
      ) FROM ent)
  ) INTO v_res;
  RETURN v_res;
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_entregues_listar(uuid,date,date,text) TO authenticated;
