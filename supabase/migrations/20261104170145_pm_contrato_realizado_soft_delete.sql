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
