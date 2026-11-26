-- P&M · tela 135 "Tempo medido SEM clique" (CEO 25/11, go-live da agência piloto)
-- Slice 2 (base de leitura): "Esforço inferido — reaproveitar o registro de ações que já
-- alimenta 'Minhas últimas ações' no Meu dia; eventos próximos (janela configurável, padrão
-- 15 min) viram bloco de trabalho; o total do dia é limitado pela jornada e distribuído
-- entre os jobs do dia."
--
-- Esta migration entrega a RPC de LEITURA que infere, por pessoa e por dia, quanto tempo
-- foi gasto em cada job — SEM a pessoa cronometrar. O "Seu dia / fechamento do dia"
-- (slice 3) consome esta função para montar as horas por job já prontas para confirmar.
--
-- RD-26 (reúso): NÃO cria tabela, evento, gatilho nem coluna. Reaproveita os sinais de
-- atividade que o Meu dia já usa — `agency_job_comentarios` (comentário escrito),
-- `agency_job_status_hist` (mudança de etapa/status do job, #6198/FASE-2B) e
-- `agency_timesheet` (início de cronômetro). Nenhum custo/hora é gravado aqui: a função é
-- somente-leitura; quem grava a hora confirmada é o slice 3 (com confirmação da pessoa).
--
-- SEGURANÇA / RD-94.1:
--  - ADITIVA: só CREATE OR REPLACE de UMA função NOVA (não existe hoje). Não altera
--    tabela, RLS, grant, gatilho nem função existente; não toca read-model financeiro.
--  - SECURITY DEFINER com guarda de empresa (fn_agency_assert) + REVOKE anon.
--  - LGPD (tela 135): a pessoa só vê o PRÓPRIO dia. p_user_id só pode ser diferente de
--    auth.uid() para admin (o painel do gestor virá em slice revisado à parte).
--  - Somente-leitura, filtrada por empresa + usuário + dia (sem varredura de tabela
--    grande: os três sinais têm índice por (company_id/job_id, data)).
-- RD-38 (prova no PR): lógica provada em dataset sintético realista — sessionização por
--  janela e teto por jornada (85 min brutos < 480 → sem teto; com jornada=1h → 85→60).
-- Code: desenvolvedor_4_g

CREATE OR REPLACE FUNCTION public.fn_pm_dia_esforco_inferido(
  p_company_id    uuid,
  p_user_id       uuid    DEFAULT NULL,      -- NULL = o próprio usuário logado
  p_data          date    DEFAULT NULL,      -- NULL = hoje (America/Sao_Paulo)
  p_janela_min    integer DEFAULT 15,        -- gap máximo entre ações do mesmo bloco
  p_jornada_horas numeric DEFAULT 8          -- teto do dia (horas)
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := COALESCE(p_user_id, auth.uid());
  v_data    date := COALESCE(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_janela  int  := GREATEST(COALESCE(p_janela_min, 15), 1);
  v_teto    numeric := GREATEST(COALESCE(p_jornada_horas, 8), 0) * 60.0;  -- em minutos (0 = sem teto)
  v_jobs    jsonb;
  v_total   numeric := 0;
  v_bruto   numeric := 0;
  v_teto_ok boolean := false;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);

  -- LGPD: só o próprio dia, exceto admin
  IF v_user IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'esforco_inferido_so_proprio_dia';
  END IF;

  WITH ev AS (
    -- comentário escrito pela pessoa no job
    SELECT c.job_id, c.criado_em AS ts
      FROM public.agency_job_comentarios c
     WHERE c.company_id = p_company_id AND c.autor_id = v_user
       AND c.excluido_em IS NULL AND c.job_id IS NOT NULL
       AND (c.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = v_data
    UNION ALL
    -- mudança de etapa/status do job feita pela pessoa
    SELECT h.job_id, h.mudou_em
      FROM public.agency_job_status_hist h
     WHERE h.company_id = p_company_id AND h.mudou_por = v_user
       AND h.job_id IS NOT NULL
       AND (h.mudou_em AT TIME ZONE 'America/Sao_Paulo')::date = v_data
    UNION ALL
    -- início de cronômetro (ação explícita de trabalho no job)
    SELECT t.job_id, t.inicio_em
      FROM public.agency_timesheet t
     WHERE t.company_id = p_company_id AND t.user_id = v_user
       AND t.excluido_em IS NULL AND t.job_id IS NOT NULL AND t.inicio_em IS NOT NULL
       AND (t.inicio_em AT TIME ZONE 'America/Sao_Paulo')::date = v_data
  ),
  ord AS (
    SELECT job_id, ts,
           CASE WHEN LAG(ts) OVER (PARTITION BY job_id ORDER BY ts) IS NULL
                 OR EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (PARTITION BY job_id ORDER BY ts)))/60.0 > v_janela
                THEN 1 ELSE 0 END AS novo_bloco
      FROM ev
  ),
  grp AS (
    SELECT job_id, ts, SUM(novo_bloco) OVER (PARTITION BY job_id ORDER BY ts) AS bloco
      FROM ord
  ),
  blocos AS (
    -- minutos do bloco = tempo de calendário entre a 1ª e a última ação + uma janela de trabalho
    SELECT job_id, bloco,
           EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts)))/60.0 + v_janela AS min_bloco,
           COUNT(*) AS eventos
      FROM grp GROUP BY job_id, bloco
  ),
  por_job AS (
    SELECT job_id, COUNT(*) AS blocos, SUM(eventos) AS eventos, SUM(min_bloco) AS min_bruto
      FROM blocos GROUP BY job_id
  )
  SELECT COALESCE(SUM(min_bruto),0) INTO v_bruto FROM por_job;

  -- teto por jornada: se o bruto passa da jornada, distribui proporcionalmente até o teto
  v_teto_ok := (v_teto > 0 AND v_bruto > v_teto);

  WITH ev AS (
    SELECT c.job_id, c.criado_em AS ts
      FROM public.agency_job_comentarios c
     WHERE c.company_id = p_company_id AND c.autor_id = v_user
       AND c.excluido_em IS NULL AND c.job_id IS NOT NULL
       AND (c.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = v_data
    UNION ALL
    SELECT h.job_id, h.mudou_em
      FROM public.agency_job_status_hist h
     WHERE h.company_id = p_company_id AND h.mudou_por = v_user
       AND h.job_id IS NOT NULL
       AND (h.mudou_em AT TIME ZONE 'America/Sao_Paulo')::date = v_data
    UNION ALL
    SELECT t.job_id, t.inicio_em
      FROM public.agency_timesheet t
     WHERE t.company_id = p_company_id AND t.user_id = v_user
       AND t.excluido_em IS NULL AND t.job_id IS NOT NULL AND t.inicio_em IS NOT NULL
       AND (t.inicio_em AT TIME ZONE 'America/Sao_Paulo')::date = v_data
  ),
  ord AS (
    SELECT job_id, ts,
           CASE WHEN LAG(ts) OVER (PARTITION BY job_id ORDER BY ts) IS NULL
                 OR EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (PARTITION BY job_id ORDER BY ts)))/60.0 > v_janela
                THEN 1 ELSE 0 END AS novo_bloco
      FROM ev
  ),
  grp AS (
    SELECT job_id, ts, SUM(novo_bloco) OVER (PARTITION BY job_id ORDER BY ts) AS bloco FROM ord
  ),
  blocos AS (
    SELECT job_id, bloco,
           EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts)))/60.0 + v_janela AS min_bloco,
           COUNT(*) AS eventos
      FROM grp GROUP BY job_id, bloco
  ),
  por_job AS (
    SELECT job_id, COUNT(*) AS blocos, SUM(eventos) AS eventos, SUM(min_bloco) AS min_bruto
      FROM blocos GROUP BY job_id
  ),
  final AS (
    SELECT pj.job_id, pj.blocos, pj.eventos,
           CASE WHEN v_teto_ok THEN pj.min_bruto * v_teto / NULLIF(v_bruto,0) ELSE pj.min_bruto END AS min_final,
           -- confiança/origem da hora (base do slice 4): timer = alta; muitos eventos = média
           CASE
             WHEN EXISTS (SELECT 1 FROM public.agency_timesheet t
                           WHERE t.company_id = p_company_id AND t.user_id = v_user
                             AND t.job_id = pj.job_id AND t.excluido_em IS NULL
                             AND (t.inicio_em AT TIME ZONE 'America/Sao_Paulo')::date = v_data)
                  THEN 'alta'
             WHEN pj.eventos >= 3 THEN 'media'
             ELSE 'baixa'
           END AS confianca
      FROM por_job pj
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'job_id',   f.job_id,
             'numero',   j.numero,
             'titulo',   j.titulo,
             'blocos',   f.blocos,
             'eventos',  f.eventos,
             'minutos',  round(f.min_final, 1),
             'horas',    round(f.min_final/60.0, 2),
             'origem',   'inferida',
             'confianca', f.confianca
           ) ORDER BY f.min_final DESC
         ), '[]'::jsonb),
         COALESCE(SUM(f.min_final), 0)
    INTO v_jobs, v_total
    FROM final f
    JOIN public.agency_jobs j ON j.id = f.job_id AND j.company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user,
    'data', v_data,
    'janela_min', v_janela,
    'jornada_horas', p_jornada_horas,
    'teto_aplicado', v_teto_ok,
    'total_horas_inferidas', round(COALESCE(v_total,0)/60.0, 2),
    'jobs', COALESCE(v_jobs, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_dia_esforco_inferido(uuid, uuid, date, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_dia_esforco_inferido(uuid, uuid, date, integer, numeric) TO authenticated, service_role;
