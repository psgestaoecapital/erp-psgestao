-- Ferramenta do Code-Auditor (eng-chefe-auto), PDCA do Hub (msg eng_chefe 17/10 08:35, item 3).
-- Problema: fn_auditor_disparar postava a foto no screen-watcher/playwright SEM empresa_id -> a foto voltava 403
-- (o endpoint renderiza sempre na DEMO da área; sem empresa_id não há sessão). A /dashboard/projetos/calculadora
-- usa a área 'projetos', que não estava mapeada em demo_por_area -> fn_demo_da_area('projetos') = NULL -> não fotografava.
-- Correção ADITIVA (RD-97), espelhando fn_disparar_playwright_batch, que já faz certo:
--   (1) mapear a área 'projetos' para a DEMO do Hub (Construtora Modelo, b0700000-…-006), guardada por is_demo;
--   (2) fn_auditor_disparar resolve empresa_id := fn_demo_da_area(area da tela) e envia no corpo da foto.
--       Sem DEMO mapeada: NÃO fotografa (RD-69/LGPD — nunca renderizar empresa real), devolve aviso 'sem_demo'.
-- Nada existente é apagado/alterado em dado de cliente. Só config de auditoria + redefinição da própria função do auditor.
-- Plano de volta (rollback):
--   DELETE FROM public.demo_por_area WHERE area = 'projetos';
--   e restaurar a versão anterior de fn_auditor_disparar (sem empresa_id) a partir do histórico.

-- (1) Apelido de área 'projetos' -> DEMO do Hub (Construtora Modelo). Aditivo, idempotente.
INSERT INTO public.demo_por_area (area, company_id)
SELECT v.area, v.company_id::uuid
FROM (VALUES
  ('projetos', 'b0700000-0000-4000-a000-000000000006')
) AS v(area, company_id)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v.company_id::uuid AND c.is_demo = true)
ON CONFLICT DO NOTHING;

-- (2) fn_auditor_disparar passa a enviar empresa_id (DEMO da área), como o batch já faz.
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

  -- DEMO da área da tela (nunca empresa real — RD-69/LGPD)
  v_empresa := fn_demo_da_area(v_area);

  -- Sem DEMO mapeada: não fotografa (evita 403 e render de empresa real); segue só o insight.
  IF v_empresa IS NULL THEN
    v_insight_dispatch := fn_disparar_insight_auditor(p_rota := v_rota_base, p_limit := 1);
    RETURN jsonb_build_object(
      'sucesso', true,
      'rota', p_rota,
      'rota_base', v_rota_base,
      'screen_id', v_screen_id,
      'area', v_area,
      'empresa_id', NULL,
      'aviso', 'sem_demo: área sem DEMO mapeada em demo_por_area; foto não disparada (RD-69/LGPD)',
      't0', v_t0,
      'insight_dispatch', v_insight_dispatch,
      'instrucao_caller', 'Mapeie a área em demo_por_area para habilitar a foto; insight segue com o screenshot existente'
    );
  END IF;

  -- Disparar Playwright na DEMO da área
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

COMMENT ON FUNCTION public.fn_auditor_disparar(text) IS
  'Dispara foto (Playwright) + insight do auditor para a rota, SEMPRE na DEMO da área (fn_demo_da_area). '
  'Sem DEMO mapeada não fotografa (RD-69/LGPD). Ferramenta do Code-Auditor (eng-chefe-auto).';
