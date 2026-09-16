-- Central de Dev — correções v2 na RPC das três barras (RD-38/RD-44), provadas no dado:
--   1) BPO em-uso = só FLUXO operacional (tarefas/execuções/conversas/contratos). Hoje 0.
--      Fechamento mensal por robô é AUTOMAÇÃO, não uso — mostrado à parte (não conta no em-uso).
--   2) pm ("P&M" = agência de marketing) estava mapeado em prod_* (produção INDUSTRIAL) — sentidos
--      opostos, mesmo tipo de erro do ge_roadmap_ondas. Corrigido: pm → agency_* (Pdois, no dado);
--      prod_* pertence a INDUSTRIAL (Frioeste/Tryo, no dado).
--   3) AUDITADO passa a medir gold_screen_buttons (Camada 2 do robô — o que ele CLICA), não
--      auditavel_robo (flag de capacidade). A Oficina tem 4 telas com gold_buttons (#1451) e
--      aparecia "sem dado"; a Revenda tem 4/4 (auditado=100%, real). "sem dado" só quando 0 telas.

-- 1) papel/rotulo no mapa de uso: fluxo (conta no em-uso) vs automacao (mostrado à parte)
ALTER TABLE public.dev_area_tabela_uso ADD COLUMN IF NOT EXISTS papel  text NOT NULL DEFAULT 'fluxo';
ALTER TABLE public.dev_area_tabela_uso ADD COLUMN IF NOT EXISTS rotulo text;

-- pm: remover prod_* (produção industrial — não é P&M) e mapear agency_* (agência de marketing)
DELETE FROM public.dev_area_tabela_uso WHERE area_slug='pm';
INSERT INTO public.dev_area_tabela_uso (area_slug, table_name, papel) VALUES
  ('pm','agency_briefings','fluxo'),('pm','agency_clientes','fluxo'),('pm','agency_equipe','fluxo'),
  ('pm','agency_jobs','fluxo'),('pm','agency_propostas','fluxo'),('pm','agency_tarefas','fluxo'),
  ('pm','agency_timesheet','fluxo')
ON CONFLICT (area_slug, table_name) DO NOTHING;

-- prod_* pertence a INDUSTRIAL (produção)
INSERT INTO public.dev_area_tabela_uso (area_slug, table_name, papel) VALUES
  ('industrial','prod_cargo','fluxo'),('industrial','prod_cargo_vinculo','fluxo'),('industrial','prod_conversao','fluxo'),
  ('industrial','prod_fluxo','fluxo'),('industrial','prod_fluxo_etapa','fluxo'),('industrial','prod_fonte_dados','fluxo'),
  ('industrial','prod_posto','fluxo'),('industrial','prod_posto_turno','fluxo'),('industrial','prod_setor','fluxo'),
  ('industrial','prod_setor_vinculo','fluxo'),('industrial','prod_tempo_padrao','fluxo'),('industrial','prod_tipo_posto','fluxo'),
  ('industrial','prod_unidade_medida','fluxo')
ON CONFLICT (area_slug, table_name) DO NOTHING;

-- BPO: só o fluxo operacional conta como uso; o resto é automação/infra (fechamento por robô etc.)
UPDATE public.dev_area_tabela_uso SET papel='fluxo'
  WHERE area_slug='bpo' AND table_name IN ('bpo_tarefas','bpo_execucoes','bpo_conversas','bpo_contratos');
UPDATE public.dev_area_tabela_uso SET papel='automacao'
  WHERE area_slug='bpo' AND table_name NOT IN ('bpo_tarefas','bpo_execucoes','bpo_conversas','bpo_contratos');
UPDATE public.dev_area_tabela_uso SET rotulo='fechamento mensal' WHERE area_slug='bpo' AND table_name='bpo_fechamento_mensal';
UPDATE public.dev_area_tabela_uso SET rotulo='inbox'            WHERE area_slug='bpo' AND table_name='bpo_inbox_items';

-- 2) RPC v2 (mudou a assinatura: colunas de auditoria e automação novas → DROP antes)
DROP FUNCTION IF EXISTS public.fn_dev_central_barras();
CREATE OR REPLACE FUNCTION public.fn_dev_central_barras()
RETURNS TABLE (
  area_slug            text,
  status_comercial     text,
  telas                integer,
  construido_pct       numeric,
  construido_sem_dado  boolean,
  telas_auditadas      integer,
  auditado_pct         numeric,
  auditado_sem_dado    boolean,
  tem_tabelas_proprias boolean,
  em_uso_empresas      integer,
  em_uso_nomes         text[],
  em_uso_ultima_escrita date,
  em_uso_sem_dado      boolean,
  automacao_rotulo     text,
  automacao_empresas   integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_created boolean; v_updated boolean; v_company boolean; v_expr text;
BEGIN
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
    -- alias: system_screens usa hub_construcao/revenda; area_menu_config usa hub/revenda_veiculos
    SELECT CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END AS a,
           count(*)::int AS telas,
           round(100.0*(count(*) FILTER (WHERE s.estado_real='pronto') + 0.5*count(*) FILTER (WHERE s.estado_real='parcial'))/NULLIF(count(*),0),0) AS construido,
           -- AUDITADO = telas que o robô exercita (têm gold_screen_buttons, Camada 2)
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.gold_screen_buttons g WHERE g.screen_id=s.id))::int AS auditadas
    FROM public.system_screens s GROUP BY 1
  ),
  fluxo AS (
    SELECT u.area_slug,
      count(DISTINCT u.company_id) FILTER (WHERE u.ultima >= now()-interval '30 days')::int AS empresas,
      array_agg(DISTINCT COALESCE(c.nome_fantasia,c.razao_social)) FILTER (WHERE u.ultima >= now()-interval '30 days') AS nomes,
      max(u.ultima)::date AS ultima
    FROM _uso u JOIN public.companies c ON c.id=u.company_id AND COALESCE(c.is_demo,false)=false
    WHERE u.papel='fluxo'
    GROUP BY u.area_slug
  ),
  autom_por_tabela AS (
    SELECT u.area_slug, u.rotulo,
      count(DISTINCT u.company_id) FILTER (WHERE u.ultima >= now()-interval '30 days') AS empresas
    FROM _uso u JOIN public.companies c ON c.id=u.company_id AND COALESCE(c.is_demo,false)=false
    WHERE u.papel='automacao'
    GROUP BY u.area_slug, u.rotulo
  ),
  autom AS (  -- por vertical, a automação com mais empresas (ex.: BPO → fechamento mensal)
    SELECT DISTINCT ON (apt.area_slug) apt.area_slug, apt.rotulo, apt.empresas::int
    FROM autom_por_tabela apt WHERE apt.empresas > 0 AND apt.rotulo IS NOT NULL
    ORDER BY apt.area_slug, apt.empresas DESC
  ),
  tem_tab AS (SELECT DISTINCT d.area_slug FROM public.dev_area_tabela_uso d)
  SELECT
    amc.area_slug,
    amc.status_comercial,
    COALESCE(scr.telas,0),
    scr.construido,
    (scr.telas IS NULL OR scr.telas=0),
    COALESCE(scr.auditadas,0),
    CASE WHEN COALESCE(scr.telas,0)=0 THEN NULL ELSE round(100.0*scr.auditadas/scr.telas,0) END,
    (COALESCE(scr.telas,0)=0),
    (tt.area_slug IS NOT NULL),
    CASE WHEN tt.area_slug IS NULL THEN NULL ELSE COALESCE(fluxo.empresas,0) END,
    fluxo.nomes,
    fluxo.ultima,
    (tt.area_slug IS NULL),
    autom.rotulo,
    autom.empresas
  FROM public.area_menu_config amc
  LEFT JOIN scr ON scr.a=amc.area_slug
  LEFT JOIN fluxo ON fluxo.area_slug=amc.area_slug
  LEFT JOIN autom ON autom.area_slug=amc.area_slug
  LEFT JOIN tem_tab tt ON tt.area_slug=amc.area_slug
  WHERE amc.ativo=true ORDER BY amc.area_slug;
END; $$;
