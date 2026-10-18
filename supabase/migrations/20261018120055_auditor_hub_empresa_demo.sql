-- Ferramenta do Code-Auditor (eng-chefe-auto) — fazer a auditoria VISUAL do Hub funcionar.
-- Tarefa do Eng. Chefe (msg 1b9efbfd, item 3): "corrija por PR a fn_auditor_disparar para enviar
-- empresa_id (hoje a foto volta 403) e mapeie a área 'projetos' para a DEMO em fn_demo_da_area,
-- para a /dashboard/projetos/calculadora entrar na auditoria."
--
-- PROVADO NO DADO (RD-38) nesta sessão:
--   1) fn_demo_da_area('projetos') = NULL  -> /dashboard/projetos/calculadora (area='projetos')
--      é pulada como "sem_demo" e nunca é fotografada.
--   2) fn_auditor_disparar(rota) NÃO envia empresa_id no corpo -> o screen-watcher devolve 403.
--   3) fn_disparar_playwright_batch aplica LIMIT antes de filtrar "sem_demo": numa rodada real
--      (refresh, limit 10) os 10 escolhidos eram todos de áreas sem DEMO (operacao/admin/industrial)
--      e 0 fotos saíram — o Hub quase nunca é fotografado por esse caminho.
--
-- TUDO ADITIVO (RD-97): só INSERT de apelido de área (DEMO que já existe) e CREATE OR REPLACE de
-- duas funções de FERRAMENTA do auditor (não tocam financeiro/fiscal/RLS/auth/dado de cliente).
-- O screen-watcher só renderiza a empresa DEMO (LGPD preservado; o batch continua pulando sem_demo).
--
-- ROLLBACK: reverter este arquivo (as duas funções voltam ao corpo anterior; a linha de apelido
-- 'projetos' pode permanecer sem efeito colateral ou ser removida com
--   DELETE FROM public.demo_por_area WHERE area='projetos';).

-- 1) Apelido de área: 'projetos' -> Construtora Modelo - DEMO (mesmo DEMO de 'hub_construcao').
INSERT INTO public.demo_por_area (area, company_id)
SELECT 'projetos', 'b0700000-0000-4000-a000-000000000006'::uuid
WHERE EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.id = 'b0700000-0000-4000-a000-000000000006'::uuid AND c.is_demo = true
)
ON CONFLICT DO NOTHING;

-- 2) fn_auditor_disparar: resolve a empresa DEMO da área da tela e ENVIA empresa_id no corpo
--    (corrige o 403). Fallback para o DEMO do Hub nas rotas /dashboard/projetos*.
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
  v_body jsonb;
BEGIN
  v_rota_base := SPLIT_PART(p_rota, '?', 1);
  v_screen_id_gerado := REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g');

  -- Garantir rota cadastrada (rota do Hub nasce com area 'hub_construcao' para já mapear ao DEMO).
  SELECT id, area INTO v_screen_id, v_area FROM system_screens WHERE rota = v_rota_base;
  IF v_screen_id IS NULL THEN
    v_area := CASE WHEN v_rota_base LIKE '/dashboard/projetos%' THEN 'hub_construcao' ELSE NULL END;
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
  END IF;

  -- Resolver a empresa DEMO da área (fallback para o DEMO do Hub nas rotas /dashboard/projetos*).
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL AND v_rota_base LIKE '/dashboard/projetos%' THEN
    v_empresa := fn_demo_da_area('hub_construcao');
  END IF;

  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Área sem empresa DEMO mapeada (RD-69/LGPD: não renderiza empresa real)',
      'rota', p_rota,
      'area', v_area
    );
  END IF;

  -- Corpo com empresa_id (corrige o 403 do screen-watcher).
  v_body := jsonb_build_object('rota', p_rota, 'empresa_id', v_empresa);

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

  -- Disparar Insight Auditor em paralelo (será analisado quando o screenshot estiver pronto).
  v_insight_dispatch := fn_disparar_insight_auditor(
    p_rota := v_rota_base,
    p_limit := 1
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'rota', p_rota,
    'rota_base', v_rota_base,
    'screen_id', v_screen_id,
    'empresa_id', v_empresa,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;

-- 3) fn_disparar_playwright_batch: pré-filtrar para áreas QUE MAPEIAM a um DEMO, para o LIMIT não
--    ser gasto em telas "sem_demo" (foi por isso que a rodada real disparou 0 no Hub). A checagem
--    por linha (fn_demo_da_area) continua como segunda trava LGPD.
CREATE OR REPLACE FUNCTION public.fn_disparar_playwright_batch(p_limit integer DEFAULT 10, p_modo text DEFAULT 'baseline'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      -- só telas cuja área mapeia a um DEMO existente (não gasta o LIMIT com "sem_demo")
      AND EXISTS (
        SELECT 1 FROM demo_por_area d
        JOIN companies c ON c.id = d.company_id AND c.is_demo = true
        WHERE d.area = s.area
      )
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
