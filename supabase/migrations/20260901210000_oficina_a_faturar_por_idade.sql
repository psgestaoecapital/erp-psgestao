-- Oficina · "Dinheiro esquecido" — OS ENTREGUES e NÃO FATURADAS, por idade.
-- Relatório que sai de graça do Bloco D: das OS entregues não faturadas, algumas podem ser
-- serviço prestado que ninguém cobrou. O CEO pediu levantar por idade e mostrar à Jordana —
-- pode ser dinheiro esquecido. Na KGF: 116 OS = R$ 107.425,00 (95 com valor; mais antiga 40 dias).
--
-- Régua canônica (RD-52, a mesma da reserva/baixa): status='entregue' AND NOT titulos_gerados,
-- excluída_em IS NULL. Ordena pela IDADE (mais antiga no topo — mais em risco de esquecimento).
-- Não toca no fn_oficina_entregues_listar (histórico por período segue intacto, RD-30).

CREATE OR REPLACE FUNCTION public.fn_oficina_a_faturar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  WITH af AS (
    SELECT o.id AS os_id, o.numero, o.cliente_nome, o.placa, o.entregue_em,
           COALESCE(o.total, 0) AS total,
           -- idade em dias desde a entrega (fallback conclusão/criação se entregue_em ausente)
           (CURRENT_DATE - COALESCE(o.entregue_em::date, o.data_conclusao, o.created_at::date)) AS dias
    FROM erp_os o
    WHERE o.company_id = p_company_id
      AND o.status = 'entregue'
      AND o.excluida_em IS NULL
      AND NOT COALESCE(o.titulos_gerados, false)
  )
  SELECT jsonb_build_object(
    'ok', true,
    'linhas', COALESCE((SELECT jsonb_agg(to_jsonb(af) ORDER BY af.dias DESC NULLS LAST, af.total DESC) FROM af), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'soma_total', COALESCE(SUM(total), 0),
        'mais_antiga_dias', COALESCE(MAX(dias), 0),
        'sem_valor', COUNT(*) FILTER (WHERE total <= 0)   -- OS entregue sem valor lançado (serviço a precificar)
      ) FROM af)
  ) INTO v_res;
  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_a_faturar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oficina_a_faturar(uuid) TO authenticated, service_role;
