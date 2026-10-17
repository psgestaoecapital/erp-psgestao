-- Auditor (eng-chefe-auto): fn_auditor_disparar passa a empresa de DEMONSTRAÇÃO no disparo do Playwright.
--
-- Problema (CEO 17/10): o disparo do banco mandava só { rota } para /api/screen-watcher/playwright.
-- Sem empresa, o endpoint caía na empresa padrão (PS Gestao LTDA, is_demo=false) e devolvia 403
-- "só demonstração" (RD-69/RD-70), deixando o run "pending" para sempre. Resultado: a foto do Hub
-- voltava 403 e a /dashboard/projetos/* não entrava na auditoria real.
--
-- Correção (ADITIVA, RD-97):
--   1) Mapeia a área 'projetos' (Hub de obras, /dashboard/projetos/*) para a DEMO Construtora Modelo
--      em demo_por_area, para fn_demo_da_area('projetos') resolver.
--   2) fn_auditor_disparar deriva a área pelo 3º segmento da rota (/dashboard/<area>/...), resolve a
--      DEMO por fn_demo_da_area e inclui empresa_id no CORPO do disparo. O endpoint lê o corpo primeiro
--      (empresaDoPedidoRobo), então a foto passa a ser capturada na DEMO certa.
--   - Se a rota já traz ?company_id= (override manual), NÃO sobrescreve.
--   - Se a área não tem DEMO mapeada, o corpo fica igual ao de antes (comportamento inalterado).
--
-- Rollback: a função é CREATE OR REPLACE — reverter é reaplicar a versão anterior (corpo sem empresa_id)
-- e, se preciso, DELETE FROM demo_por_area WHERE area='projetos'. Não há perda de dado de cliente:
-- demo_por_area só mapeia empresas is_demo=true e a função só toca o caminho do robô/auditor.

INSERT INTO public.demo_por_area (area, company_id)
VALUES ('projetos', 'b0700000-0000-4000-a000-000000000006')
ON CONFLICT (area) DO NOTHING;

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

  -- Empresa de DEMONSTRAÇÃO da área (3º segmento de /dashboard/<area>/...). A foto do robô só abre
  -- empresa is_demo=true; sem isso o endpoint devolve 403. Respeita ?company_id= explícito na rota.
  v_area := NULLIF(SPLIT_PART(v_rota_base, '/', 3), '');
  IF v_area IS NOT NULL AND POSITION('company_id=' IN p_rota) = 0 THEN
    v_empresa_demo := fn_demo_da_area(v_area);
  END IF;

  v_body := jsonb_build_object('rota', p_rota);
  IF v_empresa_demo IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('empresa_id', v_empresa_demo::text);
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
    'empresa_demo', v_empresa_demo,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;
