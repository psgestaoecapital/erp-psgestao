-- Indústria · Visão Quadro (posto a posto) — slice 2b (CEO 11/11): expor Centro de custo e Supervisor
-- por linha, para os filtros da planilha ICP. ADITIVO: só acrescenta dois campos ao JSON de cada posto
-- da `lista` (pp.centro_custo / pp.supervisor_nome, já existentes em prod_posto). Nenhuma regra de acesso,
-- nenhum KPI e nenhum custo mudam — o gate da folha (fn__pode_ver_folha / LGPD) continua idêntico.
-- RD-26: mesma RPC viva fn_rh_quadro_lotacao; RD-97: assinatura e demais campos preservados.
CREATE OR REPLACE FUNCTION public.fn_rh_quadro_lotacao(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pode_salario boolean; v_kpis jsonb; v_lista jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  v_pode_salario := fn__pode_ver_folha(p_company_id);  -- gate da folha (LGPD)

  -- Uma CTE em uma única instrução gera KPIs e lista (CTE só vive dentro de uma instrução).
  WITH custo AS (
    SELECT DISTINCT ON (pc.posto_id) pc.posto_id,
           COALESCE(pc.mao_obra_mes,0) * (1 + COALESCE(pc.encargos_pct,0)/100.0) AS custo_mes
    FROM prod_posto_custo pc
    WHERE pc.company_id = p_company_id AND pc.deleted_at IS NULL
    ORDER BY pc.posto_id, pc.vigencia_inicio DESC NULLS LAST
  ),
  -- Quadro projetado = prod_posto_turno.pessoas (fonte única), por horário de entrada do turno.
  turnos AS (
    SELECT pt.posto_id, pt.pessoas,
           row_number() OVER (PARTITION BY pt.posto_id ORDER BY pt.hora_entrada NULLS LAST, pt.turno_id) AS rn
    FROM prod_posto_turno pt
    WHERE pt.company_id = p_company_id
      AND (pt.vigencia_fim IS NULL OR pt.vigencia_fim >= CURRENT_DATE)
  ),
  proj AS (
    SELECT posto_id,
           COALESCE(SUM(pessoas), 0)                      AS proj_total,
           COALESCE(SUM(pessoas) FILTER (WHERE rn = 1),0) AS proj_t1,
           COALESCE(SUM(pessoas) FILTER (WHERE rn = 2),0) AS proj_t2,
           COALESCE(SUM(pessoas) FILTER (WHERE rn = 3),0) AS proj_t3
    FROM turnos GROUP BY posto_id
  ),
  p AS (
    SELECT pp.id, pp.numero, pp.atividade, pp.ativo,
           NULLIF(btrim(pp.centro_custo), '')    AS centro_custo,
           NULLIF(btrim(pp.supervisor_nome), '') AS supervisor_nome,
           COALESCE(pr.proj_total, 0) AS proj_total,
           COALESCE(pr.proj_t1, 0) AS proj_t1, COALESCE(pr.proj_t2, 0) AS proj_t2, COALESCE(pr.proj_t3, 0) AS proj_t3,
           st.nome AS setor_nome, cg.nome AS cargo_nome,
           COALESCE(c.custo_mes, 0) AS custo_mes,
           (SELECT count(DISTINCT COALESCE(x.funcionario_id::text, x.cpf, x.id::text))
              FROM prod_posto_pessoa x
             WHERE x.posto_id = pp.id AND (x.vigencia_fim IS NULL OR x.vigencia_fim >= CURRENT_DATE)) AS reais
    FROM prod_posto pp
    LEFT JOIN prod_setor st ON st.id = pp.setor_id
    LEFT JOIN prod_cargo  cg ON cg.id = pp.cargo_id
    LEFT JOIN custo        c ON c.posto_id = pp.id
    LEFT JOIN proj        pr ON pr.posto_id = pp.id
    WHERE pp.company_id = p_company_id
  ),
  kpi AS (
    SELECT jsonb_build_object(
      'postos_ativos',    count(*) FILTER (WHERE ativo),
      'postos_ocupados',  count(*) FILTER (WHERE ativo AND reais > 0),
      'vagas_abertas',    count(*) FILTER (WHERE ativo AND reais < proj_total),
      'proj_total',       COALESCE(sum(proj_total) FILTER (WHERE ativo), 0),
      'real_total',       COALESCE(sum(reais) FILTER (WHERE ativo), 0),
      'custo_registrado', CASE WHEN v_pode_salario THEN COALESCE(sum(custo_mes) FILTER (WHERE ativo), 0) ELSE NULL END
    ) AS j FROM p
  ),
  lst AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'setor', COALESCE(setor_nome, 'Sem setor'),
        'posto_id', id, 'codigo_po', numero, 'cargo', cargo_nome, 'atividade', atividade,
        'centro_custo', centro_custo, 'supervisor', supervisor_nome,
        'proj_t1', proj_t1, 'proj_t2', proj_t2, 'proj_t3', proj_t3, 'proj_total', proj_total,
        'real', reais, 'gap', proj_total - reais,
        'custo', CASE WHEN v_pode_salario THEN custo_mes ELSE NULL END
      ) ORDER BY COALESCE(setor_nome, 'Sem setor'), numero), '[]'::jsonb) AS j
    FROM p WHERE ativo
  )
  SELECT kpi.j, lst.j INTO v_kpis, v_lista FROM kpi, lst;

  RETURN jsonb_build_object('ok', true, 'pode_salario', v_pode_salario, 'kpis', v_kpis, 'lista', v_lista);
END;
$function$;

-- Segurança (check_fn_guards): SECURITY DEFINER só para usuário logado — anon nunca chama a RPC.
-- CREATE OR REPLACE preserva os grants; estas linhas apenas re-afirmam o estado já vigente (no-op funcional).
REVOKE ALL ON FUNCTION public.fn_rh_quadro_lotacao(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_rh_quadro_lotacao(uuid) TO authenticated;
