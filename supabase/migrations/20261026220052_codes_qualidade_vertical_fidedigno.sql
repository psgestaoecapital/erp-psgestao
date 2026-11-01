-- Aba Codes · gráfico "Qualidade por vertical" FIDEDIGNO (CEO 26/10).
-- PROBLEMA PROVADO pelo CEO: o gráfico lia system_screens.estado_real (rótulo pronto/parcial),
-- CONGELADO desde 20/10 (quando a auditoria visual caiu). Mostrava mentira: vertical "100%
-- construído" com nota real 47, telas nunca auditadas aparecendo como alto %.
-- CORREÇÃO (RD-38 — só mostrar o que foi MEDIDO): a fonte passa a ser a NOTA REAL do auditor
-- (system_screens_insights.score_evolucao_pct, última análise por rota), contando SÓ telas com
-- FOTO FRESCA (últimos 7 dias). Vertical sem foto fresca = "não auditada" (sem_foto_fresca=true),
-- nunca um % inventado. A data da última auditoria viaja junto, pra o CEO saber se o dado é fresco.
--
-- Aditiva: cria uma FUNÇÃO NOVA de leitura (não altera fn_dev_central_barras, que segue servindo
-- a aba Leitura) e ATUALIZA um texto de ajuda. Nenhum dado de cliente, RLS de cliente ou tabela
-- tocada. Lê tabelas globais de monitoramento (system_screens / _insights), só PS admin / service.

CREATE OR REPLACE FUNCTION public.fn_codes_qualidade_vertical()
RETURNS TABLE(
  area_slug         text,
  telas             integer,   -- total de telas mapeadas da vertical
  telas_frescas     integer,   -- telas com foto/insight nos últimos 7 dias
  nota_media        numeric,   -- média real do auditor (score_evolucao_pct) só das frescas; NULL se nenhuma
  prontas_pct       numeric,   -- % das telas da vertical com nota >= 95 (prontas de verdade); NULL se não auditada
  sem_foto_fresca   boolean,   -- true = vertical sem nenhuma foto fresca -> "não auditada" (cinza)
  ultima_auditoria  date       -- data da última análise da vertical (mesmo que vencida); NULL se nunca
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Mesma guarda da fn_dev_central_barras: só service_role ou PS admin leem o diagnóstico da esteira.
  IF NOT (auth.role() = 'service_role' OR public.fn_eh_ps_admin()) THEN RETURN; END IF;

  RETURN QUERY
  WITH norm AS (  -- normaliza a área da tela para o slug da vertical (igual à fn_dev_central_barras)
    SELECT s.rota,
           CASE s.area WHEN 'hub_construcao' THEN 'hub'
                       WHEN 'revenda'        THEN 'revenda_veiculos'
                       ELSE s.area END AS a
    FROM public.system_screens s
  ),
  ult AS (  -- última análise por rota + data da foto que a originou
    SELECT DISTINCT ON (i.rota)
           i.rota,
           i.score_evolucao_pct AS nota,
           COALESCE(i.screenshot_capturado_em, i.analisado_em) AS foto_em
    FROM public.system_screens_insights i
    ORDER BY i.rota, i.analisado_em DESC
  ),
  por_tela AS (
    SELECT n.a,
           u.nota,
           u.foto_em,
           (u.foto_em >= now() - interval '7 days') AS fresca
    FROM norm n
    LEFT JOIN ult u ON u.rota = n.rota
  ),
  agg AS (
    SELECT a,
           count(*)::int AS telas,
           count(*) FILTER (WHERE fresca)::int AS telas_frescas,
           round(avg(nota) FILTER (WHERE fresca), 0) AS nota_media,
           CASE WHEN count(*) FILTER (WHERE fresca) = 0 THEN NULL
                ELSE round(100.0 * count(*) FILTER (WHERE fresca AND nota >= 95) / count(*), 0)
           END AS prontas_pct,
           max(foto_em)::date AS ultima_auditoria
    FROM por_tela
    GROUP BY a
  )
  SELECT amc.area_slug,
         COALESCE(agg.telas, 0),
         COALESCE(agg.telas_frescas, 0),
         agg.nota_media,
         agg.prontas_pct,
         (COALESCE(agg.telas_frescas, 0) = 0) AS sem_foto_fresca,
         agg.ultima_auditoria
  FROM public.area_menu_config amc
  LEFT JOIN agg ON agg.a = amc.area_slug
  WHERE amc.ativo = true
  ORDER BY amc.area_slug;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_codes_qualidade_vertical() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_codes_qualidade_vertical() TO authenticated, service_role;

-- Ajuda (RD-95): o "?" do indicador passa a explicar a fonte NOVA (nota real do auditor, foto fresca).
UPDATE public.erp_ajuda_campo SET
  para_que_serve = 'Mostra, por vertical, a QUALIDADE REAL medida pelo auditor (robô): a NOTA MÉDIA das telas (0-100, da última análise de cada tela) e quantas estão PRONTAS de verdade (nota ≥ 95). Conta só telas com FOTO FRESCA (auditadas nos últimos 7 dias) — é o retrato honesto, ao vivo. Não usa mais o rótulo "pronto/parcial", que podia congelar e mentir.',
  exemplo = 'Hub: nota média 48 · 0% prontas · auditado hoje. Wealth: não auditada (sem foto fresca).',
  erro_comum = 'Ler "não auditada" (cinza) como 0% de qualidade: significa apenas que não há foto fresca — a vertical precisa ser re-auditada pelo robô. A data da última auditoria mostra se o dado é fresco ou vencido.'
WHERE chave = 'dev.codes.qualidade_vertical';
