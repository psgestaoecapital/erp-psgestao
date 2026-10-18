-- Code: eng-chefe-auto
-- Auditor (RD-97, CHECK do PDCA do Hub): a foto do Playwright voltava 403
-- ("empresa não é de demonstração", empresa_id="") porque fn_auditor_disparar
-- mandava só { rota } ao /api/screen-watcher/playwright, sem empresa_id. O endpoint
-- (empresaDoPedidoRobo) fecha-fechado sem empresa is_demo e o run ficava preso no 403 —
-- toda auditoria VISUAL do Hub ficava "não auditada". Eng. Chefe 17/10 08:35 (item 3).
--
-- Correção ADITIVA, sem tocar dado de cliente (RD-94.1 / RD-97):
--  (1) mapear a área 'projetos' para a DEMO do Hub (Construtora Modelo - DEMO),
--      que faltava em demo_por_area (só /dashboard/projetos/calculadora usa essa área);
--  (2) fn_auditor_disparar resolve a empresa DEMO da ÁREA da tela (fn_demo_da_area)
--      e manda empresa_id no corpo do POST. Nenhuma empresa resolvida => empresa_id nulo
--      => o endpoint segue recusando (fail-closed, LGPD: robô só em is_demo=true).
--
-- ROLLBACK: reverter este arquivo e aplicar o inverso —
--   DELETE FROM demo_por_area WHERE area='projetos';
--   e CREATE OR REPLACE da versão anterior de fn_auditor_disparar (corpo { rota } apenas).

-- (1) Área 'projetos' -> DEMO do Hub (Construtora Modelo - DEMO). Idempotente.
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('projetos', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO NOTHING;

-- (2) fn_auditor_disparar passa a enviar empresa_id (DEMO da área) ao Playwright.
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

  -- Garantir rota cadastrada (e ler a área para resolver a empresa DEMO)
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

  -- Empresa DEMO da área da tela. Sem ela o endpoint do robô devolve 403
  -- ("só demonstração") e o run ficava pendente para sempre. Nulo => segue fail-closed.
  v_empresa_id := fn_demo_da_area(v_area);

  -- Disparar Playwright (agora com empresa_id no corpo)
  BEGIN
    SELECT net.http_post(
      url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
      ),
      body := jsonb_build_object('rota', p_rota, 'empresa_id', v_empresa_id),
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
    'empresa_id', v_empresa_id,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;
