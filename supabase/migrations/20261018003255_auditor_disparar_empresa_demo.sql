-- Ferramenta do Code-Auditor (eng-chefe-auto) — pedido do Eng. Chefe (caixa 17/10 08:35, msg 1b9efbfd item 3).
-- Dois consertos ADITIVOS (RD-97) para a auditoria do Hub parar de voltar "não auditada":
--
-- (A) fn_auditor_disparar mandava só { rota } ao endpoint /api/screen-watcher/playwright. Esse endpoint
--     resolve a empresa por empresaDoPedidoRobo(body.empresa_id, rotas): sem empresa_id no corpo e sem
--     "?company_id=" na rota, cai em '' -> empresaPermitidaParaRobo('') = false -> HTTP 403 -> o run fica
--     "pending" para sempre (a foto volta 403). A via que FUNCIONA (fn_disparar_playwright_batch) resolve a
--     empresa por fn_demo_da_area(system_screens.area) e manda 'empresa_id' no corpo. Alinhamos o disparo de
--     rota única ao mesmo padrão: resolve a área da tela, pega a demo da área e manda empresa_id. Área sem
--     demo mapeada -> NÃO dispara (fail-closed, RD-69/RD-70/LGPD: nunca renderizar empresa real), devolvendo
--     o motivo em vez de gerar um run 403 preso.
--
-- (B) A tela /dashboard/projetos/calculadora ("Hub · Calculadora de Obra") está com system_screens.area =
--     'projetos', e não havia linha 'projetos' em demo_por_area -> fn_demo_da_area('projetos') = NULL -> a
--     Calculadora nunca entrava na auditoria. Mapeamos 'projetos' para a DEMO do Hub (Construtora Modelo,
--     is_demo=true), a mesma das áreas 'hub'/'hub_construcao'. INSERT idempotente (ON CONFLICT DO NOTHING).
--
-- Sem efeito em dado de cliente. Só a ferramenta do auditor e a empresa de DEMONSTRAÇÃO.
-- Plano de volta (rollback):
--   (A) restaurar a versão anterior de fn_auditor_disparar (corpo sem v_area/v_empresa, body só { rota });
--   (B) DELETE FROM public.demo_por_area WHERE area = 'projetos'; (linha criada só por esta migration).

-- (B) mapear a área 'projetos' para a DEMO do Hub (Construtora Modelo, is_demo=true)
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('projetos', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO NOTHING;

-- (A) disparo de rota única passa a resolver a empresa DEMO da área e mandá-la no corpo (empresa_id)
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

  -- Garantir rota cadastrada (e conhecer a área da tela)
  SELECT id, area INTO v_screen_id, v_area FROM system_screens WHERE rota = v_rota_base;
  IF v_screen_id IS NULL THEN
    -- rota nova: resolve a área pela rota para já nascer com demo mapeável
    SELECT area_id INTO v_area FROM public.fn_resolver_area_da_rota(v_rota_base) LIMIT 1;
    INSERT INTO system_screens (id, rota, titulo, estado_real, prioridade_monitoramento, area)
    VALUES (
      v_screen_id_gerado,
      v_rota_base,
      INITCAP(REPLACE(REGEXP_REPLACE(v_rota_base, '^/dashboard/', ''), '-', ' ')),
      'desconhecida',
      'alta',
      v_area
    )
    RETURNING id INTO v_screen_id;
  END IF;

  -- RD-69/RD-70/LGPD: o robô só fotografa empresa de DEMONSTRAÇÃO. Área sem demo mapeada ⇒ NÃO dispara
  -- (fail-closed: antes isso virava 403 preso em "pending"; agora devolve o motivo e não gera run).
  v_empresa := public.fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'area sem demo mapeada em demo_por_area — nao fotografa empresa real (LGPD)',
      'rota', p_rota,
      'rota_base', v_rota_base,
      'area', v_area,
      'screen_id', v_screen_id
    );
  END IF;

  -- Disparar Playwright — agora com empresa_id no corpo (como fn_disparar_playwright_batch)
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
    'empresa_id', v_empresa,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;

-- Guarda da função (check_fn_guards): dispara Playwright (SECURITY DEFINER), nunca aberta ao anon/authenticated.
-- Preserva o ACL vivo (service_role apenas) para o CREATE OR REPLACE não regredir a permissão.
REVOKE ALL ON FUNCTION public.fn_auditor_disparar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_disparar(text) TO service_role;
