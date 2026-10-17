-- Ferramenta do Code-Auditor (eng-chefe-auto): a foto do robô voltava 403 no disparo avulso.
--
-- Causa (provada no dado): fn_auditor_disparar mandava o corpo SÓ com { rota } ao
-- /api/screen-watcher/playwright. Sem empresa_id, o endpoint cai no default não-demo (Ps Gestão LTDA),
-- empresaPermitidaParaRobo() reprova (RD-69/LGPD: robô só fotografa empresa is_demo=true) e devolve 403
-- — a rota fica "NÃO AUDITADA". O fn_disparar_playwright_batch já resolve certo (empresa_id = DEMO da
-- área da tela); o disparo avulso ficou para trás. Este conserto alinha os dois caminhos.
--
-- Mudança 1 (ADITIVA): mapeia a área 'projetos' para a DEMO Construtora Modelo em demo_por_area, para a
--   /dashboard/projetos/calculadora (única tela com area='projetos') resolver a DEMO como as demais do Hub.
-- Mudança 2 (CREATE OR REPLACE da função existente — SENSÍVEL, via revisão): fn_auditor_disparar passa a
--   resolver a DEMO pela área da tela (mesma regra do batch) e a mandar empresa_id no corpo. Fail-closed:
--   área sem DEMO mapeada NÃO dispara (nunca renderiza/fotografa empresa real). Nenhuma tabela de cliente é
--   tocada; a função só dispara HTTP e lê/insere a própria tela em system_screens.
--
-- Plano de volta (rollback RD-97): restaurar a versão anterior de fn_auditor_disparar (corpo que mandava
--   jsonb_build_object('rota', p_rota) sem empresa_id) a partir do histórico, e
--   DELETE FROM public.demo_por_area WHERE area = 'projetos'. Sem efeito em dado de cliente nos dois sentidos.

-- ── Mudança 1: DEMO da área 'projetos' (idempotente) ──
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('projetos', 'b0700000-0000-4000-a000-000000000006')  -- Construtora Modelo - DEMO (is_demo=true)
ON CONFLICT (area) DO NOTHING;

-- ── Mudança 2: fn_auditor_disparar manda empresa_id (DEMO da área), fail-closed sem DEMO ──
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

  -- Garantir rota cadastrada (e ler a área para resolver a DEMO)
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

  -- RD-69/LGPD: o robô SÓ fotografa empresa de DEMONSTRAÇÃO. Resolve a DEMO da área da tela, igual ao
  -- fn_disparar_playwright_batch. Sem DEMO mapeada → NÃO dispara (fail-closed), para nunca renderizar
  -- empresa real. Era isto que fazia a foto voltar 403 (corpo sem empresa_id caía no default não-demo).
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'area da tela sem DEMO mapeada em demo_por_area (fail-closed LGPD)',
      'rota', p_rota,
      'area', v_area,
      'screen_id', v_screen_id
    );
  END IF;

  -- Disparar Playwright (agora COM empresa_id da DEMO da área)
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
    'area', v_area,
    'empresa_id', v_empresa,
    'screen_id', v_screen_id,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;

-- Guarda da função (check_fn_guards): dispatcher SECURITY DEFINER do robô — nunca aberto ao anon/authenticated;
-- só a conexão de serviço dispara. Preserva a ACL viva (postgres + service_role).
REVOKE ALL ON FUNCTION public.fn_auditor_disparar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_disparar(text) TO service_role;
