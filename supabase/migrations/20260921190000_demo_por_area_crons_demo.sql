-- Revenda FILA-2 · demo_por_area + crons do robô só em área com DEMO mapeada.
-- LGPD/RD-69: o robô (screen-watcher/playwright) só toca a empresa de DEMONSTRAÇÃO da área. Área sem demo
-- mapeada → 'sem_demo' → NÃO fotografa (nem faz o HTML-check). Mapa validado: company_id tem de ser is_demo.

-- ── demo_por_area: qual empresa DEMO cada área do system_screens usa ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_por_area (
  area       text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  criado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.demo_por_area ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS demo_por_area_sel_ps_admin ON public.demo_por_area;
CREATE POLICY demo_por_area_sel_ps_admin ON public.demo_por_area FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));

-- guard: a empresa mapeada TEM de ser is_demo (nunca um cliente real) — trava de INSERT/UPDATE.
CREATE OR REPLACE FUNCTION public.fn_demo_por_area_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id AND is_demo = true) THEN
    RAISE EXCEPTION 'demo_por_area.company_id deve ser is_demo (empresa %)', NEW.company_id;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS demo_por_area_guard ON public.demo_por_area;
CREATE TRIGGER demo_por_area_guard BEFORE INSERT OR UPDATE ON public.demo_por_area
  FOR EACH ROW EXECUTE FUNCTION public.fn_demo_por_area_guard();

-- mapa (decisão do CEO). Áreas sem demo (admin, public, dashboard_core, compliance, odonto, wealth,
-- assessor, contador, operacao, industrial, inteligencia, hub_construcao, integrations…) ficam de fora
-- de propósito: sem demo → o robô não fotografa (não rende empresa real).
INSERT INTO public.demo_por_area (area, company_id) VALUES
  ('revenda',            'b0700000-0000-4000-a000-000000000003'),
  ('oficina',            'b0700000-0000-4000-a000-000000000001'),
  ('pm',                 'b0700000-0000-4000-a000-000000000002'),
  ('gestao_empresarial', 'b0700000-0000-4000-a000-000000000004'),
  ('commerce',           'b0700000-0000-4000-a000-000000000004'),
  ('financeiro',         'b0700000-0000-4000-a000-000000000004'),
  ('fiscal',             'b0700000-0000-4000-a000-000000000004'),
  ('bpo',                'b0700000-0000-4000-a000-000000000004')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;

-- ── fn_demo_da_area(area) → company_id da demo (só is_demo); NULL = 'sem_demo' ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_da_area(p_area text)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT d.company_id FROM demo_por_area d
  JOIN companies c ON c.id = d.company_id AND c.is_demo = true
  WHERE d.area = p_area;
$function$;
REVOKE ALL ON FUNCTION public.fn_demo_da_area(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_da_area(text) TO authenticated, service_role;

-- ── cron 33 · fn_disparar_playwright_batch: só telas de área com demo; renderiza a demo da área ──────
CREATE OR REPLACE FUNCTION public.fn_disparar_playwright_batch(p_limit integer DEFAULT 10, p_modo text DEFAULT 'baseline')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_screen RECORD; v_request_id bigint; v_disparados int := 0; v_errors int := 0;
  v_pulados_sem_demo int := 0; v_resultados jsonb := '[]'::jsonb; v_empresa uuid;
BEGIN
  FOR v_screen IN
    SELECT s.id, s.rota, s.area, s.screenshot_atualizado_em, s.prioridade_monitoramento
    FROM system_screens s
    WHERE s.rota NOT LIKE '%[%'
      AND ( (p_modo = 'baseline' AND s.screenshot_url IS NULL)
         OR (p_modo = 'refresh'  AND (s.screenshot_url IS NULL OR s.screenshot_atualizado_em < NOW() - INTERVAL '5 minutes')) )
    ORDER BY CASE s.prioridade_monitoramento WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
             s.screenshot_atualizado_em ASC NULLS FIRST
    LIMIT p_limit
  LOOP
    v_empresa := fn_demo_da_area(v_screen.area);
    IF v_empresa IS NULL THEN
      -- área sem demo mapeada → NÃO fotografa (RD-69/LGPD: nunca renderizar empresa real)
      v_pulados_sem_demo := v_pulados_sem_demo + 1;
      v_resultados := v_resultados || jsonb_build_object('rota', v_screen.rota, 'area', v_screen.area, 'status', 'sem_demo');
      CONTINUE;
    END IF;
    BEGIN
      SELECT net.http_post(
        url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'),
        body := jsonb_build_object('rota', v_screen.rota, 'empresa_id', v_empresa),
        timeout_milliseconds := 90000
      ) INTO v_request_id;
      v_disparados := v_disparados + 1;
      v_resultados := v_resultados || jsonb_build_object('rota', v_screen.rota, 'area', v_screen.area, 'empresa_id', v_empresa, 'request_id', v_request_id);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('executado_em', NOW(), 'modo', p_modo,
    'disparados', v_disparados, 'pulados_sem_demo', v_pulados_sem_demo, 'erros', v_errors, 'detalhes', v_resultados);
END $function$;

-- ── cron 32 · fn_disparar_screen_watcher: passa a lista de áreas COM demo p/ a edge function filtrar ─
CREATE OR REPLACE FUNCTION public.fn_disparar_screen_watcher()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id bigint; v_url text := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/screen-watcher';
  v_areas text[];
BEGIN
  SELECT array_agg(d.area) INTO v_areas FROM demo_por_area d
    JOIN companies c ON c.id = d.company_id AND c.is_demo = true;
  IF v_areas IS NULL OR array_length(v_areas,1) IS NULL THEN
    RETURN jsonb_build_object('disparado', false, 'motivo', 'sem_demo_mapeada', 'disparado_em', NOW());
  END IF;
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'),
    body := jsonb_build_object('prioridade', ARRAY['critica','alta'], 'origem', 'pg_cron', 'limit', 30, 'areas_demo', to_jsonb(v_areas))
  ) INTO v_request_id;
  RETURN jsonb_build_object('request_id', v_request_id, 'disparado_em', NOW(), 'url', v_url, 'areas_demo', to_jsonb(v_areas));
END $function$;
