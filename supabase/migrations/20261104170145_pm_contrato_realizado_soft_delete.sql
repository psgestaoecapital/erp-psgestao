-- fn_agency_contrato_realizado: não contar jobs excluídos (soft-delete) no contratado x realizado.
-- RD-98 p4 (exclusão rastreável): job com excluido_em preenchido saiu do controle e NÃO pode
-- inflar 'criados'/'entregues' nem aparecer em 'jobs_sem_servico'.
-- Prova RD-38 (produção, 03/11): agency_jobs tem 9564 linhas, 9495 com excluido_em preenchido e
-- status não cancelado — ou seja, 9495 jobs excluídos estavam vazando para a contagem do realizado.
-- Correção aditiva: só adiciona o filtro j.excluido_em IS NULL nas DUAS varreduras de agency_jobs.
-- Sem mudança de assinatura, RLS ou grants (SECURITY DEFINER, guarda de empresa intactos).

CREATE OR REPLACE FUNCTION public.fn_agency_contrato_realizado(p_contrato_id uuid, p_periodo_ref date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_itens jsonb; v_sem_servico jsonb;
BEGIN
  SELECT company_id INTO v_company FROM agency_contratos WHERE id = p_contrato_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT jsonb_agg(row_to_json(t)) INTO v_itens FROM (
    SELECT
      ci.id AS item_id, ci.servico_id, ci.tipo_servico,
      COALESCE(sv.nome, ci.tipo_servico) AS servico_nome,
      ci.quantidade_contratada, ci.unidade, ci.periodicidade,
      (ci.quantidade_contratada IS NULL) AS sem_limite,
      jn.ini AS periodo_ini, jn.fim AS periodo_fim,
      cnt.criados, cnt.entregues,
      CASE WHEN ci.quantidade_contratada IS NULL THEN NULL
           ELSE ci.quantidade_contratada - cnt.criados END AS saldo,
      CASE
        WHEN ci.quantidade_contratada IS NULL THEN 'sem_limite'
        WHEN cnt.criados > ci.quantidade_contratada THEN 'a_mais'
        WHEN cnt.criados = ci.quantidade_contratada THEN 'em_dia'
        ELSE 'a_menos' END AS situacao
    FROM agency_contrato_itens ci
    LEFT JOIN agency_servico sv ON sv.id = ci.servico_id
    CROSS JOIN LATERAL fn_agency_item_janela(ci.periodicidade, p_periodo_ref) jn
    CROSS JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE TRUE) AS criados,
        count(*) FILTER (WHERE j.status = 'publicado') AS entregues
      FROM agency_jobs j
      WHERE j.contrato_id = p_contrato_id
        AND j.excluido_em IS NULL
        AND j.status NOT IN ('cancelado','cancelada')
        AND (
          (ci.servico_id IS NOT NULL AND j.servico_id = ci.servico_id)
          OR (ci.servico_id IS NULL AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico)))
        )
        AND (jn.ini IS NULL OR (j.created_at::date >= jn.ini AND j.created_at::date < jn.fim))
    ) cnt
    WHERE ci.contrato_id = p_contrato_id
    ORDER BY ci.tipo_servico
  ) t;

  -- jobs sem serviço vinculado (servico_id nulo) — trabalho que some do controle
  SELECT jsonb_agg(jsonb_build_object('tipo', tp, 'qtd', qtd)) INTO v_sem_servico FROM (
    SELECT COALESCE(NULLIF(lower(btrim(tipo)),''),'(sem tipo)') tp, count(*) qtd
    FROM agency_jobs j
    WHERE j.contrato_id = p_contrato_id AND j.servico_id IS NULL
      AND j.excluido_em IS NULL
      AND j.status NOT IN ('cancelado','cancelada')
    GROUP BY 1 ORDER BY 2 DESC
  ) x;

  RETURN jsonb_build_object('ok', true, 'contrato_id', p_contrato_id,
    'periodo_ref', p_periodo_ref,
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'jobs_sem_servico', COALESCE(v_sem_servico, '[]'::jsonb));
END;
$function$;

-- fn_agency_contrato_listar: o indicador 'itens_a_mais' (itens com entregas acima do
-- contratado) na LISTA de contratos contava agency_jobs sem excluido_em IS NULL — mesmo
-- vazamento de soft-delete (RD-98 p4) na mesma tela /dashboard/pm/contratos. Correção
-- aditiva: só adiciona o filtro na subconsulta de agency_jobs. Assinatura/RLS/grants iguais.
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_listar(p_company_id uuid)
 RETURNS TABLE(contrato_id uuid, cliente_nome text, erp_cliente_id uuid, proposta_id uuid, tipo text, fee_mensal numeric, ge_valor_mensal numeric, erp_contrato_id uuid, tem_contrato_ge boolean, status text, data_inicio date, itens_total integer, itens_a_mais integer, escopo_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  RETURN QUERY
  SELECT c.id,
    COALESCE(ac.nome_fantasia, ac.nome, ec.nome_fantasia, ec.razao_social, '—'),
    c.erp_cliente_id, c.proposta_id, c.tipo,
    c.fee_mensal, gc.valor_atual, c.erp_contrato_id, (c.erp_contrato_id IS NOT NULL),
    c.status, c.data_inicio,
    (SELECT count(*)::int FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id) AS itens_total,
    (SELECT count(*)::int FROM agency_contrato_itens ci
       CROSS JOIN LATERAL fn_agency_item_janela(ci.periodicidade, CURRENT_DATE) jn
       WHERE ci.contrato_id = c.id AND ci.quantidade_contratada IS NOT NULL
         AND (SELECT count(*) FROM agency_jobs j
              WHERE j.contrato_id = c.id AND j.excluido_em IS NULL
                AND j.status NOT IN ('cancelado','cancelada')
                AND ((ci.servico_id IS NOT NULL AND j.servico_id = ci.servico_id)
                     OR (ci.servico_id IS NULL AND lower(btrim(j.tipo)) = lower(btrim(ci.tipo_servico))))
                AND (jn.ini IS NULL OR (j.created_at::date >= jn.ini AND j.created_at::date < jn.fim))
             ) > ci.quantidade_contratada) AS itens_a_mais,
    CASE WHEN (SELECT count(*) FROM agency_contrato_itens ci WHERE ci.contrato_id = c.id) = 0
         THEN 'sem_escopo' ELSE 'com_escopo' END AS escopo_status
  FROM agency_contratos c
  LEFT JOIN agency_clientes ac ON ac.id = c.cliente_id
  LEFT JOIN erp_clientes ec ON ec.id = c.erp_cliente_id
  LEFT JOIN erp_contratos gc ON gc.id = c.erp_contrato_id
  WHERE c.company_id = p_company_id
  ORDER BY c.criado_em DESC;
END;
$function$;

-- REVOKE anon (check-fn-guards Regra 1): re-declara o ACL vivo das 2 funções SECURITY DEFINER recriadas.
-- ACL vivo confirmado (RD-38): {postgres, authenticated, service_role} — sem anon/PUBLIC; CREATE OR REPLACE preserva.
REVOKE ALL ON FUNCTION public.fn_agency_contrato_realizado(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_agency_contrato_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_realizado(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_listar(uuid) TO authenticated, service_role;
