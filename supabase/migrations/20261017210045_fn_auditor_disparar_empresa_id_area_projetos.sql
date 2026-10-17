-- Ferramenta do auditor (eng-chefe-auto / RD-97): corrigir a foto do Hub que voltava 403.
--
-- Contexto (CEO 17/10, PDCA do Hub): a foto do screen-watcher de /dashboard/projetos/* voltava 403
-- ("só demonstração") e o run ficava "pending" para sempre. Causa: fn_auditor_disparar mandava só
-- { rota } ao /api/screen-watcher/playwright, SEM empresa_id. Sem empresa_id no corpo (e sem
-- ?company_id= na rota), empresaDoPedidoRobo() devolve '' e empresaPermitidaParaRobo() recusa (403).
-- fn_disparar_playwright_batch já resolvia a empresa pela área (fn_demo_da_area) e mandava empresa_id;
-- aqui o auditor-unitário passa a fazer o mesmo.
--
-- Também: mapear a área 'projetos' (da /dashboard/projetos/calculadora) para a DEMO do Hub
-- (Construtora Modelo), para a Calculadora entrar na auditoria. A trava demo_por_area_guard garante
-- is_demo=true (Construtora Modelo é demo), e RLS/policies da tabela ficam intactas.

-- 1) Mapear área 'projetos' → DEMO do Hub (Construtora Modelo). ADITIVO, idempotente.
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('projetos', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO NOTHING;

-- 2) fn_auditor_disparar: resolver a empresa DEMO da área e mandar empresa_id no corpo.
--    Área sem DEMO mapeada → NÃO fotografa (RD-69/LGPD: nunca renderizar empresa real), devolve informativo.
CREATE OR REPLACE FUNCTION public.fn_auditor_disparar(p_rota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_screen_id text;
  v_screen_id_gerado text;
  v_area text;
  v_empresa uuid;
  v_t0 timestamptz := clock_timestamp();
  v_request_id_playwright bigint;
  v_rota_base text;
  v_insight_dispatch jsonb;
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
    RETURNING id, area INTO v_screen_id, v_area;
  END IF;

  -- Empresa DEMO da área (RD-69/LGPD). Sem empresa_id o endpoint devolve 403 e o run fica "pending".
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'area sem DEMO mapeada em demo_por_area (nao fotografa empresa real)',
      'rota', p_rota,
      'area', v_area
    );
  END IF;

  -- Disparar Playwright (com empresa_id -> passa na checagem is_demo do endpoint)
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
    'area', v_area,
    'empresa_id', v_empresa,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;
