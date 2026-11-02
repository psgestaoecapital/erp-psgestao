-- CEO 02/11 · Blueprint P&M §3 — "Medição de tempo configurável por etapa e por cliente" · PR3 (consumo do cálculo).
-- PR1 (#3735) criou a tabela agency_etapa_medicao_config; PR2 (#3755) entregou a tela de configuração +
-- fn_agency_etapa_medicao_listar/_salvar com a resolução cliente > agência > sistema (padrão do sistema = conta como custo).
-- ESTA PR faz o CUSTO DIRETO (timesheet × custo_hora) considerar SÓ as etapas marcadas como "medir"=true,
-- aplicando a MESMA resolução cliente > agência > sistema por linha de apontamento.
--
-- Aditiva no comportamento: sem nenhuma configuração, COALESCE(...,true) mantém TODAS as etapas contando — o
-- resultado é IDÊNTICO ao de hoje (backward-compatible). Só muda quando a agência/cliente desliga uma etapa.
--
-- RD-38 (prova no dado, DEMO Agência b0700000-0000-4000-a000-000000000002, read-only, antes/depois):
--   antes_todas_etapas = 8539.95 · depois (regra de agência: etapa 'job' medir=false) = 1125.00 · excluído = 7414.95.
--   Sem config: antes = depois (nenhuma mudança de comportamento).
--
-- Mesma assinatura e contrato de retorno de fn_pm_job_custos(uuid) -> (job_id, horas, tem_custo, custo_total).
-- Mantém SECURITY DEFINER + a guarda de empresa já existente; nenhuma tabela/coluna/dado de cliente é alterado.

CREATE OR REPLACE FUNCTION public.fn_pm_job_custos(p_company_id uuid)
 RETURNS TABLE(job_id uuid, horas numeric, tem_custo boolean, custo_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH medido AS (
      SELECT
        t.job_id,
        t.horas,
        t.custo_hora,
        t.custo_total,
        -- resolução por linha: regra do cliente > regra da agência (cliente_id IS NULL) > padrão do sistema (true)
        COALESCE(cli.medir, ag.medir, true) AS medir
      FROM agency_timesheet t
      LEFT JOIN agency_etapa_medicao_config ag
        ON ag.company_id = t.company_id
       AND ag.cliente_id IS NULL
       AND ag.etapa_tipo = t.etapa_tipo
      LEFT JOIN agency_etapa_medicao_config cli
        ON cli.company_id = t.company_id
       AND cli.cliente_id = t.cliente_id
       AND cli.etapa_tipo = t.etapa_tipo
      WHERE t.company_id = p_company_id
    )
    SELECT
      m.job_id,
      sum(m.horas),
      (COALESCE(m.custo_hora, 0) > 0) AS tem_custo,
      sum(m.custo_total)
    FROM medido m
    WHERE m.medir
    GROUP BY m.job_id, (COALESCE(m.custo_hora, 0) > 0);
END $function$;
