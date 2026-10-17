-- Hub HBF / PDCA (eng-chefe-auto 17/10) — a foto do auditor voltava 403 e o run ficava "pending".
--
-- Causa (prova no dado — RD-38):
--   1) fn_auditor_disparar postava { rota } SEM empresa_id. O endpoint /api/screen-watcher/playwright
--      resolve a empresa pelo corpo OU por ?company_id= na rota; sem nenhum dos dois cai no 403
--      "só demonstração" (RD-69/LGPD) e o Playwright nunca fotografa. O lote (fn_disparar_playwright_batch)
--      já mandava empresa_id; o disparo de rota única (usado também na camada 1 de
--      fn_gold_disparar_jornada_completa) não mandava.
--   2) /dashboard/projetos/calculadora está em system_screens com area = 'projetos', que não tinha
--      demo mapeada em demo_por_area → fn_demo_da_area('projetos') = NULL → rota pulada como "sem_demo".
--
-- Correção (ADITIVA, RD-97): mapear 'projetos' para a DEMO do Hub (Construtora Modelo) e resolver a
-- empresa DEMO da área no disparo de rota única, mandando empresa_id no corpo — igual ao lote. Sem demo
-- mapeada, a função NÃO dispara (devolve 'sem_demo'), em vez de gerar um run que morre no 403.
-- Nenhum comportamento de cliente muda: só o robô auditor, só em empresa is_demo.

-- ── 1) Área 'projetos' → DEMO do Hub (Construtora Modelo - DEMO). O guard de demo_por_area exige is_demo. ──
INSERT INTO public.demo_por_area (area, company_id) VALUES
  ('projetos', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO NOTHING;

-- ── 2) fn_auditor_disparar: resolve a empresa DEMO da área e manda empresa_id no corpo do Playwright ──
CREATE OR REPLACE FUNCTION public.fn_auditor_disparar(p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_screen_id text;
  v_screen_id_gerado text;
  v_t0 timestamptz := clock_timestamp();
  v_request_id_playwright bigint;
  v_rota_base text;
  v_insight_dispatch jsonb;
  v_area text;
  v_empresa uuid;
BEGIN
  v_rota_base := SPLIT_PART(p_rota, '?', 1);
  v_screen_id_gerado := REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g');

  -- Garantir rota cadastrada (e guardar a área, para o lote baseline também achar a DEMO depois)
  SELECT id, area INTO v_screen_id, v_area FROM system_screens WHERE rota = v_rota_base;
  IF v_screen_id IS NULL THEN
    SELECT area_id INTO v_area FROM fn_resolver_area_da_rota(v_rota_base);
    INSERT INTO system_screens (id, rota, titulo, area, estado_real, prioridade_monitoramento)
    VALUES (
      v_screen_id_gerado,
      v_rota_base,
      INITCAP(REPLACE(REGEXP_REPLACE(v_rota_base, '^/dashboard/', ''), '-', ' ')),
      v_area,
      'desconhecida',
      'alta'
    )
    RETURNING id INTO v_screen_id;
  ELSIF v_area IS NULL THEN
    SELECT area_id INTO v_area FROM fn_resolver_area_da_rota(v_rota_base);
  END IF;

  -- Empresa DEMO da área (RD-69/LGPD: o robô só fotografa is_demo). Sem demo mapeada → NÃO dispara:
  -- evita o 403 e o run "pending" eterno; sinaliza para mapear a área antes de auditar a rota.
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'area sem demo mapeada',
      'rota', p_rota,
      'area', v_area,
      'instrucao_caller', 'Mapear a área em demo_por_area (empresa is_demo) antes de auditar esta rota'
    );
  END IF;

  -- Disparar Playwright (manda a empresa DEMO no corpo — sem isso o run caía no 403 e ficava pending)
  BEGIN
    SELECT net.http_post(
      url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
      ),
      body := jsonb_build_object('rota', p_rota, 'empresa_id', v_empresa),
      timeout_milliseconds := 90000
    ) INTO v_request_id_playwright;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Falha disparar Playwright: ' || SQLERRM,
      'rota', p_rota
    );
  END;

  -- Disparar Insight Auditor em paralelo (analisado quando o screenshot estiver pronto)
  v_insight_dispatch := fn_disparar_insight_auditor(
    p_rota := v_rota_base,
    p_limit := 1
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'rota', p_rota,
    'rota_base', v_rota_base,
    'screen_id', v_screen_id,
    'area', v_area,
    'empresa_id', v_empresa,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;
