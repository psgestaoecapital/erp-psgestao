-- P&M · tela 135 "Tempo medido SEM clique" (CEO 25/11, go-live da agência piloto) — slice 5 (leitura).
-- "Tempo padrão por etapa e serviço após 4 semanas (alimenta a tela 134 e o preço sugerido)."
--
-- RPC somente-leitura que, para cada serviço e cada etapa-modelo, calcula o tempo típico
-- (mediana) de CALENDÁRIO medido nas instâncias já concluídas (agency_job_etapa com
-- iniciada_em e concluida_em carimbados — o "tempo sem clique" dos slices 1-3), numa janela
-- de semanas. Só vira "padrão maduro" quando há amostras suficientes (padrão: 4). É a base
-- que a tela 134 (tempo padrão) e o preço sugerido consomem.
--
-- RD-26 (reúso): lê agency_job_etapa (#6198) + agency_servico_etapa (modelo) + agency_servico
-- (nome). Nada novo é capturado. RD-94.1: ADITIVA — só uma função NOVA; não altera tabela,
-- RLS, grant, gatilho nem função existente; somente-leitura (não grava nada).
-- Segurança: SECURITY DEFINER + guarda de empresa (fn_agency_assert) + REVOKE anon.
-- RD-38 (prova no PR): lógica da mediana provada em dataset sintético (amostras 2h/3h/4h ->
--  mediana 3h, média 3h, maduro=false com <4). Query equivalente roda no schema da DEMO
--  (hoje 0 etapas concluídas -> retorna vazio, honesto, até a medição acumular).
-- Code: desenvolvedor_4_g

CREATE OR REPLACE FUNCTION public.fn_pm_servico_etapa_tempo_padrao(
  p_company_id   uuid,
  p_semanas      integer DEFAULT 4,
  p_min_amostras integer DEFAULT 4
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_semanas int := GREATEST(COALESCE(p_semanas, 4), 1);
  v_min     int := GREATEST(COALESCE(p_min_amostras, 4), 1);
  v_out     jsonb;
BEGIN
  PERFORM public.fn_agency_assert(p_company_id);

  WITH medidas AS (
    SELECT m.servico_id,
           m.id   AS servico_etapa_id,
           m.nome,
           m.ordem,
           EXTRACT(EPOCH FROM (e.concluida_em - e.iniciada_em))/3600.0 AS horas
      FROM public.agency_job_etapa e
      JOIN public.agency_servico_etapa m ON m.id = e.servico_etapa_id
     WHERE e.company_id = p_company_id
       AND e.iniciada_em IS NOT NULL
       AND e.concluida_em IS NOT NULL
       AND e.concluida_em >= now() - make_interval(weeks => v_semanas)
       AND e.concluida_em > e.iniciada_em
  ),
  por_etapa AS (
    SELECT servico_id, servico_etapa_id, nome, MIN(ordem) AS ordem,
           COUNT(*) AS amostras,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)::numeric, 2) AS mediana_h,
           round(AVG(horas)::numeric, 2) AS media_h
      FROM medidas
     GROUP BY servico_id, servico_etapa_id, nome
  ),
  por_servico AS (
    SELECT pe.servico_id,
           jsonb_agg(
             jsonb_build_object(
               'servico_etapa_id', pe.servico_etapa_id,
               'nome',             pe.nome,
               'ordem',            pe.ordem,
               'amostras',         pe.amostras,
               'tempo_padrao_horas', pe.mediana_h,
               'media_horas',      pe.media_h,
               'maduro',           (pe.amostras >= v_min)
             ) ORDER BY pe.ordem, pe.nome
           ) AS etapas
      FROM por_etapa pe
     GROUP BY pe.servico_id
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'servico_id',   ps.servico_id,
             'servico_nome', s.nome,
             'etapas',       ps.etapas
           ) ORDER BY s.nome
         ), '[]'::jsonb)
    INTO v_out
    FROM por_servico ps
    JOIN public.agency_servico s ON s.id = ps.servico_id AND s.company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true,
    'semanas', v_semanas,
    'min_amostras', v_min,
    'servicos', COALESCE(v_out, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_servico_etapa_tempo_padrao(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_servico_etapa_tempo_padrao(uuid, integer, integer) TO authenticated, service_role;
