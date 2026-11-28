-- EHS: aponta a captura/auditoria das telas /dashboard/ehs/* para a DEMO EHS (…00b).
-- Tarefa eng_chefe 3eb3dc72 / aviso 94ffda24 (bloqueio nº1 do CEO: aud8 há 3 rodadas sem nota no EHS).
--
-- RAIZ (provado no dado, RD-38, 2026-11-22):
--   - As 31 telas /dashboard/ehs/% estão com system_screens.area='compliance'.
--   - A captura (fn_disparar_playwright_batch/_rota) resolve a empresa por fn_demo_da_area(area).
--   - fn_demo_da_area('compliance') = …005 (Indústria Modelo), VAZIA de EHS.
--   - fn_demo_da_area('ehs')        = …00b (EHS Modelo - DEMO), ONDE está o seed (#5699).
--   => toda foto de /dashboard/ehs/% saía da empresa errada e não dava para auditar/selar.
--
-- CORREÇÃO: re-taguear as 31 telas /dashboard/ehs/% para area='ehs' (a captura passa a cair na …00b).
-- As demais telas de 'compliance' que NÃO são /dashboard/ehs/% (landing /dashboard/ehs,
-- /dashboard/lgpd/meus-dados, /sign/epi/[token]) continuam em 'compliance' (dependem da …005 / não-EHS),
-- conforme instrução do eng_chefe.
--
-- EFEITOS COLATERAIS conferidos (RD-38) e tratados neste mesmo PR:
--   (1) Gráficos da aba Codes e orçamento de auditoria normalizam system_screens.area → slug da vertical.
--       Como NÃO existe area_menu_config.area_slug='ehs' (a vertical EHS roda sob o slug 'compliance',
--       rótulo "Compliance/EHS"), sem mapear 'ehs'→'compliance' o EHS SUMIRIA desses gráficos.
--       Funções com a normalização que leem system_screens.area e casam com area_menu_config:
--         fn_codes_qualidade_vertical, fn_dev_central_barras,
--         fn_dev_vertical_auditoria_status(p_vertical), fn_dev_vertical_orcamento(p_vertical).
--       -> adicionado WHEN 'ehs' THEN 'compliance' na normalização das 4.
--       (fn_codes_blueprint_vertical NÃO lê system_screens.area — mapeia area_menu_config.area_slug;
--        'ehs' nunca aparece lá, então NÃO precisa mudar.)
--   (2) fn_resolver_area_da_rota: antes resolvia /dashboard/ehs/* → 'compliance' (via system_screens).
--       Com area='ehs' e sem amc 'ehs', cairia no fallback GE. Mantido o comportamento anterior
--       acrescentando o padrão /dashboard/ehs → 'compliance' na Estratégia 3 (hardcode).
--   (3) Menu/sidebar: vem de module_catalog, não de system_screens.area — não muda (conferido).
--   (4) RLS de system_screens: is_admin(), sem ramo por area — não muda.
--   (5) Trigger tg_alerta_tela_orfa: dispara só em mudança de estado_real; este UPDATE só toca area — não dispara.
--
-- Aditiva/idempotente: só UPDATE de registro interno (system_screens) e CREATE OR REPLACE de funções.
-- NÃO toca dado de cliente.

-- (1) Re-tag das 31 telas do EHS completo.
UPDATE public.system_screens
   SET area = 'ehs'
 WHERE rota LIKE '/dashboard/ehs/%'
   AND area = 'compliance';

-- (2) Normalização 'ehs'→'compliance' nas funções da aba Codes / orçamento de auditoria.

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
                       WHEN 'ehs'            THEN 'compliance'  -- EHS roda sob o slug 'compliance'
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

CREATE OR REPLACE FUNCTION public.fn_dev_central_barras()
 RETURNS TABLE(area_slug text, status_comercial text, telas integer, construido_pct numeric, construido_sem_dado boolean, telas_auditadas integer, auditado_pct numeric, auditado_sem_dado boolean, tem_tabelas_proprias boolean, em_uso_empresas integer, em_uso_nomes text[], em_uso_ultima_escrita date, em_uso_sem_dado boolean, automacao_rotulo text, automacao_empresas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_created boolean; v_updated boolean; v_company boolean; v_expr text;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.fn_eh_ps_admin()) THEN RETURN; END IF;
  CREATE TEMP TABLE _uso (area_slug text, table_name text, papel text, rotulo text, company_id uuid, ultima timestamptz) ON COMMIT DROP;
  FOR r IN SELECT m.area_slug, m.table_name, m.papel, m.rotulo FROM public.dev_area_tabela_uso m LOOP
    SELECT bool_or(column_name='created_at'), bool_or(column_name='updated_at'), bool_or(column_name='company_id')
      INTO v_created, v_updated, v_company
    FROM information_schema.columns WHERE table_schema='public' AND table_name=r.table_name;
    IF COALESCE(v_company,false)=false OR (COALESCE(v_created,false)=false AND COALESCE(v_updated,false)=false) THEN CONTINUE; END IF;
    v_expr := CASE WHEN COALESCE(v_created,false) AND COALESCE(v_updated,false) THEN 'GREATEST(created_at, updated_at)'
                   WHEN COALESCE(v_updated,false) THEN 'updated_at' ELSE 'created_at' END;
    EXECUTE format('INSERT INTO _uso(area_slug, table_name, papel, rotulo, company_id, ultima)
                    SELECT %L,%L,%L,%L, company_id, max(%s) FROM public.%I WHERE company_id IS NOT NULL GROUP BY company_id',
      r.area_slug, r.table_name, r.papel, r.rotulo, v_expr, r.table_name);
  END LOOP;
  RETURN QUERY
  WITH scr AS (
    SELECT CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' WHEN 'ehs' THEN 'compliance' ELSE s.area END AS a,
           count(*)::int AS telas,
           round(100.0*(count(*) FILTER (WHERE s.estado_real='pronto') + 0.5*count(*) FILTER (WHERE s.estado_real='parcial'))/NULLIF(count(*),0),0) AS construido,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.gold_screen_buttons g WHERE g.screen_id=s.id))::int AS auditadas
    FROM public.system_screens s GROUP BY 1
  ),
  fluxo AS (
    SELECT u.area_slug AS aslug,
      count(DISTINCT u.company_id) FILTER (WHERE u.ultima >= now()-interval '30 days')::int AS empresas,
      array_agg(DISTINCT COALESCE(c.nome_fantasia,c.razao_social)) FILTER (WHERE u.ultima >= now()-interval '30 days') AS nomes,
      max(u.ultima)::date AS ultima
    FROM _uso u JOIN public.companies c ON c.id=u.company_id AND COALESCE(c.is_demo,false)=false
    WHERE u.papel='fluxo' GROUP BY u.area_slug
  ),
  autom_por_tabela AS (
    SELECT u.area_slug AS aslug, u.rotulo AS rot,
      count(DISTINCT u.company_id) FILTER (WHERE u.ultima >= now()-interval '30 days') AS empresas
    FROM _uso u JOIN public.companies c ON c.id=u.company_id AND COALESCE(c.is_demo,false)=false
    WHERE u.papel='automacao' GROUP BY u.area_slug, u.rotulo
  ),
  autom AS (
    SELECT DISTINCT ON (apt.aslug) apt.aslug, apt.rot, apt.empresas::int AS empresas
    FROM autom_por_tabela apt WHERE apt.empresas>0 AND apt.rot IS NOT NULL
    ORDER BY apt.aslug, apt.empresas DESC
  ),
  tem_tab AS (SELECT DISTINCT d.area_slug AS aslug FROM public.dev_area_tabela_uso d)
  SELECT amc.area_slug, amc.status_comercial, COALESCE(scr.telas,0), scr.construido,
    (scr.telas IS NULL OR scr.telas=0),
    COALESCE(scr.auditadas,0),
    CASE WHEN COALESCE(scr.telas,0)=0 THEN NULL ELSE round(100.0*scr.auditadas/scr.telas,0) END,
    (COALESCE(scr.telas,0)=0),
    (tt.aslug IS NOT NULL),
    CASE WHEN tt.aslug IS NULL THEN NULL ELSE COALESCE(fluxo.empresas,0) END,
    fluxo.nomes, fluxo.ultima, (tt.aslug IS NULL),
    autom.rot, autom.empresas
  FROM public.area_menu_config amc
  LEFT JOIN scr ON scr.a=amc.area_slug
  LEFT JOIN fluxo ON fluxo.aslug=amc.area_slug
  LEFT JOIN autom ON autom.aslug=amc.area_slug
  LEFT JOIN tem_tab tt ON tt.aslug=amc.area_slug
  WHERE amc.ativo=true ORDER BY amc.area_slug;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_dev_vertical_auditoria_status(p_vertical text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT s.id, s.rota, s.titulo,
      EXISTS (SELECT 1 FROM public.gold_screen_buttons g WHERE g.screen_id = s.id) AS tem_gold
    FROM public.system_screens s
    WHERE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' WHEN 'ehs' THEN 'compliance' ELSE s.area END = p_vertical
  )
  SELECT jsonb_build_object(
    'vertical',   p_vertical,
    'total',      (SELECT count(*) FROM v),
    'auditaveis', (SELECT count(*) FROM v WHERE tem_gold),
    'sem_botao',  (SELECT count(*) FROM v WHERE NOT tem_gold),
    'auditadas',  (SELECT count(DISTINCT b.screen_id)
                     FROM public.gold_screen_buttons b
                     JOIN public.gold_camada2_validacoes val ON val.botao_id = b.id
                     WHERE b.screen_id IN (SELECT id FROM v WHERE tem_gold)),
    'ultima_em',  (SELECT max(val.executado_em)
                     FROM public.gold_screen_buttons b
                     JOIN public.gold_camada2_validacoes val ON val.botao_id = b.id
                     WHERE b.screen_id IN (SELECT id FROM v)),
    'sem_botao_lista', (SELECT COALESCE(jsonb_agg(jsonb_build_object('rota', rota, 'titulo', titulo) ORDER BY rota), '[]'::jsonb)
                          FROM v WHERE NOT tem_gold)
  )
  FROM (SELECT 1) _
  WHERE (auth.role() = 'service_role' OR public.fn_eh_ps_admin());
$function$;

CREATE OR REPLACE FUNCTION public.fn_dev_vertical_orcamento(p_vertical text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT count(*)::int AS telas FROM public.system_screens s
    WHERE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' WHEN 'ehs' THEN 'compliance' ELSE s.area END = p_vertical
  ),
  cap AS (
    SELECT limite_max_custo_usd_dia AS cap_dia, limite_max_custo_usd_mes AS cap_mes
    FROM public.anthropic_budget_control WHERE id = 1
  ),
  g AS (
    SELECT
      ( COALESCE((SELECT sum(claude_custo_usd) FROM public.system_screens_insights
                  WHERE analisado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),0)
      + COALESCE((SELECT sum(claude_custo_usd) FROM public.gold_camada2_validacoes
                  WHERE executado_em::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date),0) )::numeric AS gasto_dia,
      ( COALESCE((SELECT sum(claude_custo_usd) FROM public.system_screens_insights
                  WHERE to_char(analisado_em,'YYYY-MM') = to_char(now(),'YYYY-MM')),0)
      + COALESCE((SELECT sum(claude_custo_usd) FROM public.gold_camada2_validacoes
                  WHERE to_char(executado_em,'YYYY-MM') = to_char(now(),'YYYY-MM')),0) )::numeric AS gasto_mes
  )
  SELECT jsonb_build_object(
    'vertical', p_vertical, 'telas', t.telas,
    'custo_estimado', round(t.telas*0.013,2), 'tempo_min', GREATEST(1, round(t.telas*0.3)::int),
    'gasto_dia', round(g.gasto_dia,2), 'gasto_mes', round(g.gasto_mes,2),
    'cap_dia', cap.cap_dia, 'cap_mes', cap.cap_mes,
    'pode', ( t.telas > 0
              AND g.gasto_dia + round(t.telas*0.013,2) <= cap.cap_dia
              AND g.gasto_mes + round(t.telas*0.013,2) <= cap.cap_mes ),
    'motivo', CASE
      WHEN t.telas = 0 THEN 'Esta vertical não tem telas catalogadas para auditar.'
      WHEN g.gasto_dia + round(t.telas*0.013,2) > cap.cap_dia
        THEN format('Teto diário (US$ %s) seria estourado. Gasto hoje US$ %s.',
                    to_char(cap.cap_dia,'FM990.00'), to_char(round(g.gasto_dia,2),'FM990.00'))
      WHEN g.gasto_mes + round(t.telas*0.013,2) > cap.cap_mes
        THEN format('Teto mensal (US$ %s) seria estourado. Gasto no mês US$ %s.',
                    to_char(cap.cap_mes,'FM990.00'), to_char(round(g.gasto_mes,2),'FM990.00'))
      ELSE NULL END)
  FROM t, cap, g
  WHERE (auth.role() = 'service_role' OR public.fn_eh_ps_admin());
$function$;

-- (3) Resolução de área da rota: manter /dashboard/ehs* → 'compliance' (comportamento anterior à troca de area).
CREATE OR REPLACE FUNCTION public.fn_resolver_area_da_rota(p_pathname text)
 RETURNS TABLE(area_id text, area_nome text, rota_raiz text, origem_match text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_segmento text;
  v_area_id text;
BEGIN
  IF p_pathname IS NULL OR p_pathname = '' THEN
    p_pathname := '/dashboard';
  END IF;

  p_pathname := SPLIT_PART(p_pathname, '?', 1);
  v_segmento := SPLIT_PART(p_pathname, '/', 3);

  -- Estrategia 1: rota_raiz exata (alias explicito amc)
  SELECT amc.id INTO v_area_id
  FROM area_menu_config amc
  WHERE p_pathname LIKE amc.rota_raiz || '%'
    AND amc.ativo = true
  ORDER BY LENGTH(amc.rota_raiz) DESC
  LIMIT 1;

  IF v_area_id IS NOT NULL THEN
    RETURN QUERY
    SELECT amc.id, amc.nome_menu, amc.rota_raiz, 'rota_raiz_exata'::text
    FROM area_menu_config amc
    WHERE amc.id = v_area_id;
    RETURN;
  END IF;

  -- Estrategia 2: system_screens mapa
  SELECT area INTO v_area_id
  FROM (
    SELECT
      ss.area,
      COUNT(*) AS qtd,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn
    FROM system_screens ss
    WHERE ss.rota LIKE '/dashboard/' || v_segmento || '/%'
       OR ss.rota = '/dashboard/' || v_segmento
    GROUP BY ss.area
  ) ranked
  WHERE ranked.rn = 1;

  -- EHS roda sob o slug 'compliance' (não há area_menu_config 'ehs'): mantém a resolução anterior.
  IF v_area_id = 'ehs' THEN
    v_area_id := 'compliance';
  END IF;

  IF v_area_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM area_menu_config amc WHERE amc.id = v_area_id AND amc.ativo = true
  ) THEN
    RETURN QUERY
    SELECT amc.id, amc.nome_menu, amc.rota_raiz, 'system_screens_mapa'::text
    FROM area_menu_config amc
    WHERE amc.id = v_area_id;
    RETURN;
  END IF;

  -- Estrategia 3: patterns hardcode (rotas novas nao catalogadas)
  v_area_id := CASE
    WHEN p_pathname LIKE '/dashboard/ehs/%' THEN 'compliance'
    WHEN p_pathname = '/dashboard/ehs' THEN 'compliance'
    WHEN p_pathname LIKE '/dashboard/cadastros/%' THEN 'gestao_empresarial'
    WHEN p_pathname LIKE '/dashboard/admin/%' THEN 'compliance'
    WHEN p_pathname LIKE '/dashboard/lgpd/%' THEN 'compliance'
    WHEN p_pathname LIKE '/dashboard/conciliacao%' THEN 'gestao_empresarial'
    WHEN p_pathname LIKE '/dashboard/dre%' THEN 'gestao_empresarial'
    WHEN p_pathname LIKE '/dashboard/operacional%' THEN 'gestao_empresarial'
    ELSE NULL
  END;

  IF v_area_id IS NOT NULL THEN
    RETURN QUERY
    SELECT amc.id, amc.nome_menu, amc.rota_raiz, 'pattern_hardcode'::text
    FROM area_menu_config amc
    WHERE amc.id = v_area_id;
    RETURN;
  END IF;

  -- Estrategia 4: fallback GE
  RETURN QUERY
  SELECT amc.id, amc.nome_menu, amc.rota_raiz, 'fallback_default_GE'::text
  FROM area_menu_config amc
  WHERE amc.id = 'gestao_empresarial';
END;
$function$;

-- ── Segurança (check:fn-guards · revoke_anon) ───────────────────────────────
-- Funções SECURITY DEFINER de leitura do painel de desenvolvimento/áreas:
-- fecham para anon/PUBLIC e abrem só para usuário logado e serviço.
REVOKE ALL ON FUNCTION public.fn_codes_qualidade_vertical() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_codes_qualidade_vertical() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_dev_central_barras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_central_barras() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_dev_vertical_auditoria_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_vertical_auditoria_status(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_dev_vertical_orcamento(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_vertical_orcamento(text) TO authenticated, service_role;

-- ACL viva é service_role-only (postgres, service_role); chamada só server-side.
-- Não adicionar authenticated: função SECURITY DEFINER sem guarda interna. (revisor 22/11)
REVOKE ALL ON FUNCTION public.fn_resolver_area_da_rota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_resolver_area_da_rota(text) TO service_role;
