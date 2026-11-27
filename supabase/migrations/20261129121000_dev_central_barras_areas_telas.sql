-- Saneamento Fase 3 (telas reais) — Central de Dev: barras Construído/Auditado pelas áreas da vertical (follow-up #6409/#6411).
--
-- Problema provado no dado (27/11): no topo do documento vivo, Industrial mostrava "Auditado (1/24)", enquanto a auditoria
-- (#6409) e o orçamento (#6411) contam 35 telas. fn_dev_central_barras agrupava system_screens pelo CASE antigo de área
-- (hub_construcao→hub, revenda→revenda_veiculos) e por isso deixava de fora as telas de área 'industria'.
--
-- Muda SÓ a contagem de telas (CTE scr: telas, Construído, Auditado). Cada tela vale para cada vertical de dev_vertical
-- cujas áreas a incluem (areas_telas; NULL = {slug}), o mesmo filtro da auditoria. Tela cuja área nenhuma vertical de
-- dev_vertical cobre segue o CASE antigo (fallback). Barra de Uso (dev_area_tabela_uso, _uso, fluxo, automação),
-- assinatura, guarda (service_role ou PS admin) e grants: iguais.
--
-- ATENÇÃO revisor: altera números de outras verticais, não só Industrial (ex.: E-commerce 0→8 telas, porque a área
-- 'commerce' está inativa no menu e agora conta para 'ecommerce'). Ver a prova antes × depois no PR.
--
-- Aditiva e idempotente: só CREATE OR REPLACE da função (o ADD COLUMN IF NOT EXISTS é no-op depois da #6409 e só protege a
-- ordem de publicação). Não toca coleta nem ETL, não altera dado. RD-52: nome do arquivo = versão do ledger.

ALTER TABLE public.dev_vertical ADD COLUMN IF NOT EXISTS areas_telas text[];

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
  WITH dv AS (
    SELECT d.slug, COALESCE(d.areas_telas, ARRAY[d.slug]) AS areas FROM public.dev_vertical d
  ),
  tela_vert AS (  -- Fase 3: tela → vertical pelo mesmo filtro da auditoria; área sem vertical = CASE antigo
    SELECT s.id, s.estado_real, dv.slug AS a
      FROM public.system_screens s JOIN dv ON s.area = ANY(dv.areas)
    UNION ALL
    SELECT s.id, s.estado_real,
           CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END
      FROM public.system_screens s
     WHERE NOT EXISTS (SELECT 1 FROM dv WHERE s.area = ANY(dv.areas))
  ),
  scr AS (
    SELECT tv.a,
           count(*)::int AS telas,
           round(100.0*(count(*) FILTER (WHERE tv.estado_real='pronto') + 0.5*count(*) FILTER (WHERE tv.estado_real='parcial'))/NULLIF(count(*),0),0) AS construido,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.gold_screen_buttons g WHERE g.screen_id=tv.id))::int AS auditadas
    FROM tela_vert tv GROUP BY 1
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

-- Mesmos grants de hoje (authenticated + service_role; anon/PUBLIC sem acesso).
REVOKE ALL ON FUNCTION public.fn_dev_central_barras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_central_barras() TO authenticated, service_role;
