-- Auditor do Hub (RD-97): a FOTO voltava 403 quando disparada pela via de uma rota só.
--
-- Causa (confirmada no dado): fn_auditor_disparar enviava o corpo { rota } SEM empresa_id e a rota
-- não trazia "?company_id=". No endpoint /api/screen-watcher/playwright, empresaDoPedidoRobo devolve ''
-- (fail-closed) e empresaPermitidaParaRobo recusa com 403 "só demonstração" — o run ficava "pending".
-- O fn_disparar_playwright_batch já resolvia a empresa DEMO pela ÁREA da tela (fn_demo_da_area) e por
-- isso o lote funcionava; só a via de rota única estava sem essa resolução.
--
-- Correção (aditiva, não-destrutiva — RD-52/RD-97):
--   1) Mapear a área 'projetos' (usada hoje só por /dashboard/projetos/calculadora) para a DEMO do Hub
--      (Construtora Modelo), para a Calculadora entrar na auditoria pelo lote e pela rota.
--   2) fn_auditor_disparar passa a resolver a empresa DEMO pela área da tela (mesma regra do lote) e a
--      enviar empresa_id no corpo; se a rota já trouxer ?company_id= explícito, respeita e não sobrepõe.
--
-- Rollback (RD-97): reverter esta migration restaura o corpo anterior do fn_auditor_disparar; para
--   desfazer o mapa, DELETE FROM public.demo_por_area WHERE area='projetos'. Nenhum dado de cliente é
--   tocado (demo_por_area só referencia empresas is_demo=true; a tela volta a cair em 403 "só demo",
--   o estado anterior).

-- 1) Mapa de área DEMO para 'projetos' (aditivo, idempotente). FK garante empresa existente; a empresa
--    é a DEMO do Hub (is_demo=true), nunca cliente real.
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('projetos', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO NOTHING;

-- 2) fn_auditor_disparar com resolução da empresa DEMO pela área (fail-closed se área sem DEMO).
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
  v_empresa_na_rota text;
  v_body jsonb;
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

  -- RD-69/LGPD: o robô SÓ fotografa empresa de DEMONSTRAÇÃO. Resolve a empresa DEMO pela área da tela
  -- (igual ao fn_disparar_playwright_batch). Se a rota já traz ?company_id= explícito, o endpoint usa o
  -- da rota (corpo primeiro, depois rota) — então não sobrepomos, para preservar o atalho manual.
  v_empresa_na_rota := (regexp_match(p_rota, '[?&](?:company_id|empresa_id)=([0-9a-fA-F-]{36})'))[1];
  v_empresa := fn_demo_da_area(v_area);

  v_body := jsonb_build_object('rota', p_rota);
  IF v_empresa_na_rota IS NULL AND v_empresa IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('empresa_id', v_empresa);
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
