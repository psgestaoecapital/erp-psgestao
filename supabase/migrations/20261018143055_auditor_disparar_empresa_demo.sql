-- Auditor (eng-chefe-auto) · ferramenta de disparo de foto/jornada.
--
-- PROBLEMA (CEO 17/10, "feche o ciclo"): fn_auditor_disparar mandava só { rota } ao endpoint
-- /api/screen-watcher/playwright. O endpoint resolve a empresa por empresaDoPedidoRobo(corpo, rotas):
-- sem empresa_id no corpo e sem ?company_id= na rota, a empresa sai vazia, cai no 403 "só demonstração"
-- (RD-69/LGPD) e a foto nunca é tirada. Resultado: toda auditoria sob demanda voltava "não auditada".
--
-- CORREÇÃO (ADITIVA — RD-97): espelha o padrão já comprovado de fn_disparar_playwright_batch —
-- resolve a empresa DEMO da ÁREA da tela (system_screens.area) por fn_demo_da_area e manda
-- empresa_id no corpo. Área sem DEMO mapeada => devolve erro claro em vez de 403 silencioso.
--
-- Além disso, mapeia a área 'projetos' (hoje só /dashboard/projetos/calculadora) para a mesma
-- DEMO do Hub (Construtora Modelo Demonstração LTDA) para a Calculadora entrar na auditoria.
-- As demais telas do Hub já usam area hub/hub_construcao, ambas mapeadas.
--
-- Rollback: reaplicar a versão anterior de fn_auditor_disparar (corpo sem empresa_id) e
-- DELETE FROM demo_por_area WHERE area='projetos'. Mudança restrita à ferramenta do auditor;
-- não toca dado de cliente, financeiro, fiscal, RLS, auth nem cron.

-- 1) Mapear a área 'projetos' -> DEMO do Hub (aditivo, idempotente)
INSERT INTO demo_por_area (area, company_id)
SELECT 'projetos', 'b0700000-0000-4000-a000-000000000006'::uuid
WHERE NOT EXISTS (SELECT 1 FROM demo_por_area WHERE area = 'projetos');

-- 2) fn_auditor_disparar: resolver e enviar empresa_id DEMO no corpo
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
  v_area text;
  v_empresa uuid;
  v_insight_dispatch jsonb;
BEGIN
  v_rota_base := SPLIT_PART(p_rota, '?', 1);
  v_screen_id_gerado := REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g');

  -- Garantir rota cadastrada (e descobrir a área)
  SELECT id, area INTO v_screen_id, v_area FROM system_screens WHERE rota = v_rota_base;
  IF v_screen_id IS NULL THEN
    INSERT INTO system_screens (id, rota, titulo, estado_real, prioridade_monitoramento)
    VALUES (
      v_screen_id_gerado,
      v_rota_base,
      INITCAP(REPLACE(REGEXP_REPLACE(v_rota_base, '^/dashboard/', ''), '-', ' ')),
      'desconhecida',
      'alta'
    )
    RETURNING id, area INTO v_screen_id, v_area;
  END IF;

  -- RD-69/LGPD: o robô SÓ fotografa empresa DEMO. Resolve a empresa DEMO da área da tela e manda
  -- empresa_id no corpo; sem isso o endpoint cai no 403 "só demonstração" e o run fica pending.
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'area sem DEMO mapeada em demo_por_area; nao da para fotografar com empresa real (RD-69/LGPD)',
      'rota', p_rota,
      'rota_base', v_rota_base,
      'area', v_area,
      'screen_id', v_screen_id
    );
  END IF;

  -- Disparar Playwright (agora com empresa_id DEMO)
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

  -- Disparar Insight Auditor em paralelo (analisa quando o screenshot estiver pronto)
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
