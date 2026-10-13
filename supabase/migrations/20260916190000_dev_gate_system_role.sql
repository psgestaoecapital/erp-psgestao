-- 🔴 SEGURANÇA — a Central de Desenvolvimento é da PS, não dos clientes.
-- O gate anterior usava users.role ('adm'), que QUALQUER admin de empresa cliente tem
-- (Luzardo/Pdois, Fábio/Alliance…) → veriam o painel interno da PS, o custo de IA e o
-- estado das 14 verticais. Isso é VAZAMENTO. O gate certo é users.system_role, e nunca o robô.
--   PS_ADMIN / PS_ADMIN_CVM, is_robo=false → hoje 4 pessoas: Gilberto, André, Jordana, Rodrigo.
-- Fecha: as duas RLS (documento + pedido) E as três RPCs SECURITY DEFINER (que devolviam dado
-- a qualquer autenticado). O service_role (auditor/rota) continua passando.

CREATE OR REPLACE FUNCTION public.fn_eh_ps_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')
      AND COALESCE(u.is_robo, false) = false
  );
$$;
GRANT EXECUTE ON FUNCTION public.fn_eh_ps_admin() TO authenticated, service_role;

-- guard reutilizável: PS_ADMIN humano OU chamada de serviço (auditor/rota via service_role)
-- (auth.role() = 'service_role' nas chamadas com a service key)

-- RLS: documento vivo — leitura só PS_ADMIN humano
DROP POLICY IF EXISTS erp_doc_vertical_admin_read ON public.erp_documento_vertical;
CREATE POLICY erp_doc_vertical_admin_read ON public.erp_documento_vertical
  FOR SELECT USING (public.fn_eh_ps_admin());

-- RLS: pedidos de atualização — leitura só PS_ADMIN humano
DROP POLICY IF EXISTS erp_dev_pedido_admin_read ON public.erp_dev_vertical_pedido;
CREATE POLICY erp_dev_pedido_admin_read ON public.erp_dev_vertical_pedido
  FOR SELECT USING (public.fn_eh_ps_admin());

-- RPC das três barras — devolve vazio para quem não é PS_ADMIN (nem serviço)
CREATE OR REPLACE FUNCTION public.fn_dev_central_barras()
RETURNS TABLE (
  area_slug text, status_comercial text, telas integer,
  construido_pct numeric, construido_sem_dado boolean,
  telas_auditadas integer, auditado_pct numeric, auditado_sem_dado boolean,
  tem_tabelas_proprias boolean, em_uso_empresas integer, em_uso_nomes text[],
  em_uso_ultima_escrita date, em_uso_sem_dado boolean,
  automacao_rotulo text, automacao_empresas integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    SELECT CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END AS a,
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
END; $$;

-- RPC orçamento — null para quem não é PS_ADMIN (nem serviço; a rota chama via service_role)
CREATE OR REPLACE FUNCTION public.fn_dev_vertical_orcamento(p_vertical text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT count(*)::int AS telas FROM public.system_screens s
    WHERE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END = p_vertical
  ),
  g AS (
    SELECT COALESCE(sum(custo_estimado) FILTER (WHERE dia=(now() AT TIME ZONE 'America/Sao_Paulo')::date),0)::numeric AS gasto_dia,
           COALESCE(sum(custo_estimado) FILTER (WHERE dia>=date_trunc('month',(now() AT TIME ZONE 'America/Sao_Paulo')::date)),0)::numeric AS gasto_mes
    FROM public.erp_dev_vertical_pedido
  )
  SELECT jsonb_build_object('vertical',p_vertical,'telas',t.telas,
    'custo_estimado',round(t.telas*0.013,2),'tempo_min',GREATEST(1,round(t.telas*0.3)::int),
    'gasto_dia',round(g.gasto_dia,2),'gasto_mes',round(g.gasto_mes,2),'cap_dia',1.00,'cap_mes',5.00,
    'pode',(t.telas>0 AND g.gasto_dia+round(t.telas*0.013,2)<=1.00 AND g.gasto_mes+round(t.telas*0.013,2)<=5.00),
    'motivo',CASE WHEN t.telas=0 THEN 'Esta vertical não tem telas catalogadas para auditar.'
      WHEN g.gasto_dia+round(t.telas*0.013,2)>1.00 THEN 'Teto diário (US$ 1,00) seria estourado. Tente amanhã.'
      WHEN g.gasto_mes+round(t.telas*0.013,2)>5.00 THEN 'Teto mensal (US$ 5,00) seria estourado.' ELSE NULL END)
  FROM t,g
  WHERE (auth.role()='service_role' OR public.fn_eh_ps_admin());
$$;

-- RPC badge — null para quem não é PS_ADMIN
CREATE OR REPLACE FUNCTION public.fn_dev_medidor_badge()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (SELECT count(*)::int AS rascunhos FROM public.erp_documento_vertical WHERE vigente AND status='rascunho'),
  s AS (SELECT count(*) FILTER (WHERE estado_real='quebrada')::int AS quebradas,
               count(*) FILTER (WHERE estado_real='desconhecida')::int AS desconhecidas
        FROM public.system_screens)
  SELECT jsonb_build_object('numero',r.rascunhos,'rascunhos',r.rascunhos,
    'telas_quebradas',s.quebradas,'telas_desconhecidas',s.desconhecidas,
    'cor',CASE WHEN s.quebradas>0 THEN 'vermelho' WHEN s.desconhecidas>0 OR r.rascunhos>0 THEN 'amarelo' ELSE 'verde' END)
  FROM r,s
  WHERE public.fn_eh_ps_admin();
$$;
