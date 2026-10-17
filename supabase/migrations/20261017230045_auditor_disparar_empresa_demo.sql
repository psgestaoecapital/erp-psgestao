-- PDCA do Hub (CEO 17/10) — ferramenta do Code-Auditor: a foto do auditor voltava 403 "só demonstração".
--
-- Causa (confirmada no código do endpoint /api/screen-watcher/playwright e em src/lib/gold/empresaDoPedidoRobo.ts):
-- fn_auditor_disparar mandava só { rota } no corpo, sem empresa_id. Sem empresa demo no corpo nem em
-- "?company_id=" na rota, empresaDoPedidoRobo devolve '' e a checagem is_demo do endpoint recusa com 403 —
-- a rota ficava "pending" e nunca era fotografada. Além disso, as rotas do Hub (/dashboard/projetos/*) têm
-- system_screens.area = 'projetos', que NÃO existia em demo_por_area, então nem com o mapeamento a Calculadora
-- (e as demais rotas 'projetos') resolvia a empresa demo.
--
-- Correção (aditiva, sem tocar dado de cliente):
--   1) mapeia a área 'projetos' para a mesma empresa DEMO do Hub (Construtora Modelo, is_demo=true);
--   2) fn_auditor_disparar resolve a empresa DEMO pela área da tela (fn_demo_da_area) e a envia no corpo.
--      Rota sem área mapeada segue sem empresa_id (comportamento anterior) — fail-closed no endpoint.

-- 1) Mapeamento da área 'projetos' -> DEMO do Hub (mesma empresa de 'hub'/'hub_construcao').
INSERT INTO public.demo_por_area (area, company_id)
SELECT 'projetos', d.company_id
FROM public.demo_por_area d
WHERE d.area = 'hub'
ON CONFLICT (area) DO NOTHING;

-- 2) fn_auditor_disparar passa a enviar empresa_id (DEMO da área da tela) no corpo do disparo.
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
  v_empresa_id uuid;
BEGIN
  v_rota_base := SPLIT_PART(p_rota, '?', 1);
  v_screen_id_gerado := REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g');

  -- Garantir rota cadastrada
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
    RETURNING id INTO v_screen_id;
  END IF;

  -- Empresa DEMO da área da tela (CEO 17/10): sem isso a foto caía no 403 "só demonstração".
  -- Rota sem área mapeada -> v_empresa_id NULL -> corpo sem empresa_id (comportamento anterior).
  IF v_area IS NOT NULL THEN
    v_empresa_id := fn_demo_da_area(v_area);
  END IF;

  -- Disparar Playwright
  BEGIN
    SELECT net.http_post(
      url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
      ),
      body := jsonb_strip_nulls(jsonb_build_object('rota', p_rota, 'empresa_id', v_empresa_id)),
      timeout_milliseconds := 90000
    ) INTO v_request_id_playwright;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Falha disparar Playwright: ' || SQLERRM,
      'rota', p_rota
    );
  END;

  -- Disparar Insight Auditor em paralelo (sera analisado quando screenshot estiver pronto)
  v_insight_dispatch := fn_disparar_insight_auditor(
    p_rota := v_rota_base,
    p_limit := 1
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'rota', p_rota,
    'rota_base', v_rota_base,
    'screen_id', v_screen_id,
    'empresa_id', v_empresa_id,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;
