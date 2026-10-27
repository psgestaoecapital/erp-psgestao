-- Qualidade por vertical lê a NOTA DO AUDITOR MAX (erp_auditor_matriz_resultados), não mais a tabela antiga
-- system_screens_insights (API externa desligada). A chave da matriz traz query string (?area=...&company_id=...),
-- então a comparação é pela rota base. Por rota vale a nota mais recente do Max; a tabela antiga só entra como
-- fallback para rota sem nota no Max. Assinatura de retorno preservada (o front não muda).
CREATE OR REPLACE FUNCTION public.fn_codes_qualidade_vertical()
 RETURNS TABLE(area_slug text, telas integer, telas_frescas integer, nota_media numeric, prontas_pct numeric, sem_foto_fresca boolean, ultima_auditoria date)
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
  ult_matriz AS (  -- nota mais recente do auditor Max por rota base (a chave da matriz traz query string)
    SELECT DISTINCT ON (split_part(m.rota_completa, '?', 1))
           split_part(m.rota_completa, '?', 1) AS rota,
           m.score_pct::numeric                AS nota,
           m.consultado_em                     AS foto_em
    FROM public.erp_auditor_matriz_resultados m
    WHERE m.status = 'completo' AND m.score_pct IS NOT NULL
    ORDER BY split_part(m.rota_completa, '?', 1), m.consultado_em DESC
  ),
  ult_insights AS (  -- fallback: tabela antiga, só para rota SEM nota no Max
    SELECT DISTINCT ON (i.rota)
           i.rota,
           i.score_evolucao_pct::numeric AS nota,
           COALESCE(i.screenshot_capturado_em, i.analisado_em) AS foto_em
    FROM public.system_screens_insights i
    ORDER BY i.rota, i.analisado_em DESC
  ),
  ult AS (
    SELECT um.rota, um.nota, um.foto_em FROM ult_matriz um
    UNION ALL
    SELECT ui.rota, ui.nota, ui.foto_em FROM ult_insights ui
     WHERE NOT EXISTS (SELECT 1 FROM ult_matriz um2 WHERE um2.rota = ui.rota)
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

-- Dado errado corrigido (Eng. Chefe 27/10): a calculadora foi cadastrada com area='projetos' enquanto as irmãs do Hub
-- estão em 'hub_construcao'. Corrige a área para entrar no Hub junto. Só esta rota.
UPDATE public.system_screens SET area = 'hub_construcao' WHERE rota = '/dashboard/projetos/calculadora' AND area = 'projetos';
