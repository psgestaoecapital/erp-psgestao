-- Evolução das telas do Hub (CEO 27/10): por tela, a nota atual do auditor Max, a anterior (outro dia), a diferença
-- e a última PR publicada que cita o módulo. A PR por tela é APROXIMAÇÃO: erp_dev_entrega não guarda os arquivos,
-- então a ligação é pelo nome do módulo no título da PR (ex.: "feat(hub/viagens)" → /dashboard/projetos/viagens).
-- Só leitura. Mesma guarda de admin da fn_codes_qualidade_vertical.
CREATE OR REPLACE FUNCTION public.fn_hub_evolucao_telas()
 RETURNS TABLE(rota text, modulo text, nota_atual numeric, nota_anterior numeric, delta numeric,
               pr_numero integer, pr_titulo text, auditada_em timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.fn_eh_ps_admin()) THEN RETURN; END IF;

  RETURN QUERY
  WITH telas_hub AS (  -- telas do Hub (area hub ou hub_construcao, como na qualidade por vertical)
    SELECT DISTINCT s.rota AS r FROM public.system_screens s WHERE s.area IN ('hub', 'hub_construcao')
  ),
  aud_dia AS (  -- 1 auditoria por rota e dia: a mais recente do dia (a chave da matriz traz query string)
    SELECT DISTINCT ON (split_part(m.rota_completa, '?', 1), (m.consultado_em AT TIME ZONE 'America/Sao_Paulo')::date)
           split_part(m.rota_completa, '?', 1)   AS r,
           m.score_pct::numeric                  AS nota,
           m.consultado_em                       AS em
    FROM public.erp_auditor_matriz_resultados m
    WHERE m.status = 'completo' AND m.score_pct IS NOT NULL
    ORDER BY split_part(m.rota_completa, '?', 1), (m.consultado_em AT TIME ZONE 'America/Sao_Paulo')::date, m.consultado_em DESC
  ),
  rk AS (
    SELECT ad.r, ad.nota, ad.em,
           row_number() OVER (PARTITION BY ad.r ORDER BY ad.em DESC) AS pos
    FROM aud_dia ad
  ),
  atual AS (SELECT rk.r, rk.nota, rk.em FROM rk WHERE rk.pos = 1),
  anterior AS (SELECT rk.r, rk.nota FROM rk WHERE rk.pos = 2),
  ult_pr AS (  -- última PR publicada cujo título cita o nome do módulo (último trecho da rota)
    SELECT t.r, pr.pr_numero, pr.pr_titulo
    FROM telas_hub t
    LEFT JOIN LATERAL (
      SELECT e.pr_numero, e.titulo AS pr_titulo
      FROM public.erp_dev_entrega e
      WHERE e.evento = 'publicada'
        AND e.titulo ILIKE '%' || regexp_replace(t.r, '^.*/', '') || '%'
      ORDER BY e.ocorrido_em DESC
      LIMIT 1
    ) pr ON true
  )
  SELECT t.r,
         regexp_replace(t.r, '^.*/', ''),
         a.nota,
         p.nota,
         a.nota - p.nota,
         up.pr_numero,
         up.pr_titulo,
         a.em
  FROM telas_hub t
  LEFT JOIN atual a    ON a.r  = t.r
  LEFT JOIN anterior p ON p.r  = t.r
  LEFT JOIN ult_pr up  ON up.r = t.r
  ORDER BY a.nota ASC NULLS FIRST, t.r;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_hub_evolucao_telas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_evolucao_telas() TO authenticated, service_role;

-- Texto do "?" do bloco novo (RD-95): chave nova em erp_ajuda_campo, idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT 'dev.codes.evolucao_telas', '/dashboard/dev/codes', 'Codes', 'Evolução das telas do Hub',
       'Nada: é leitura. Cada linha é uma tela do Hub.',
       'Mostra a nota da última auditoria do Max, a anterior e a diferença. Seta verde = subiu, cinza = igual, vermelha = caiu. A última PR é a mais recente publicada que cita o módulo no título (aproximação).',
       'Viagens: 88 na semana passada, 95 hoje → seta verde, +7.',
       'Nota de vários dias atrás: a tela ainda não foi auditada de novo pelo Max.',
       'hub', 900, 1, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'dev.codes.evolucao_telas');
