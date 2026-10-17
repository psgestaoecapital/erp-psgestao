-- Auditor visual (foto) do robo: resolver a empresa DEMO pela area da rota
--
-- Problema (achado eng-chefe-auto 17/10): fn_auditor_disparar postava so { rota } ao endpoint
-- /api/screen-watcher/playwright. O endpoint resolve a empresa por body.empresa_id ou por
-- "?company_id=" na rota (ver src/lib/gold/empresaDoPedidoRobo.ts); sem nenhum dos dois a empresa
-- ficava vazia e o guarda is_demo=true respondia 403 ("empresa nao e de demonstracao"). Resultado:
-- NENHUMA foto nova das telas do Hub era capturada (todas as 8 rotas /dashboard/projetos/* deram 403).
--
-- Correcao (pedido do Eng. Chefe, item 3 da tarefa 1b9efbfd):
--   1) mapear a area 'projetos' (2o segmento de /dashboard/projetos/*) para a DEMO Construtora Modelo;
--   2) fn_auditor_disparar resolve a DEMO da area da rota (fn_demo_da_area) e manda empresa_id no corpo.
-- Mudanca aditiva e compativel: rota com "?company_id=" explicito segue valendo; area sem mapeamento
-- em demo_por_area continua sem empresa_id (fail-closed, 403 como antes). So telas DEMO.

-- 1) Mapear a area 'projetos' para a DEMO Construtora Modelo (is_demo=true)
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('projetos', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;

-- 2) fn_auditor_disparar passa empresa_id (DEMO da area da rota) ao endpoint de foto
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
  v_empresa_demo uuid;
  v_body jsonb;
  v_insight_dispatch jsonb;
BEGIN
  v_rota_base := SPLIT_PART(p_rota, '?', 1);
  v_screen_id_gerado := REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g');

  -- Garantir rota cadastrada
  SELECT id INTO v_screen_id FROM system_screens WHERE rota = v_rota_base;
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

  -- Empresa DEMO pela area da rota (2o segmento: /dashboard/<area>/...). Se a area nao estiver em
  -- demo_por_area, v_empresa_demo fica NULL e o corpo nao leva empresa_id (o endpoint cai no
  -- "?company_id=" da rota, se houver; senao recusa com 403 — fail-closed, so DEMO).
  v_area := NULLIF(SPLIT_PART(TRIM(LEADING '/' FROM v_rota_base), '/', 2), '');
  v_empresa_demo := fn_demo_da_area(v_area);

  v_body := jsonb_build_object('rota', p_rota);
  IF v_empresa_demo IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('empresa_id', v_empresa_demo);
  END IF;

  -- Disparar Playwright
  BEGIN
    SELECT net.http_post(
      url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
      ),
      body := v_body,
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
  -- Nota: insight-auditor edge function busca telas com analise pendente, entao chama logo ja agenda
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
    'empresa_id', v_empresa_demo,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;
