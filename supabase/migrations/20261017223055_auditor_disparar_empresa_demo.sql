-- Ferramenta do Code-Auditor (eng-chefe-auto) — conserto do disparo de 1 rota (CEO/Eng. Chefe 17/10).
--
-- Problema (prova no dado, RD-38): fn_auditor_disparar manda ao robô só { rota }, SEM empresa. O robô do
-- screen-watcher resolve a empresa por empresaDoPedidoRobo(body.empresa_id, rotas): sem empresa_id no corpo e
-- sem ?company_id= na rota, a empresa fica vazia -> o robô responde 403 ("empresa não é de demonstração") e a
-- foto nunca vem. Por isso toda rota do Hub auditada por 1 disparo (e a CAMADA 1 do gold, que chama
-- fn_auditor_disparar) voltava 403. O lote (fn_disparar_playwright_batch) e a matriz (fn_auditor_matriz_disparar)
-- já mandam a empresa; o disparo de 1 rota era o único que não mandava.
--
-- Nota histórica: o conserto de 01/10 (20261001230000_auditor_matriz_conserto) evitou reescrever esta função
-- "porque tem o segredo dentro — não passa por PR". O Eng. Chefe (17/10) autoriza o conserto por PR agora: o
-- x-watcher-secret já está versionado em 3 migrations antigas (nenhum segredo novo é exposto) e sem este conserto
-- o Hub não é fotografado — o CEO exige a auditoria visual.
--
-- Conserto (ADITIVO, sem tocar dado de cliente):
--  (1) resolve a DEMO pela área da tela (fn_demo_da_area) — a mesma regra do lote/matriz — e manda
--      body.empresa_id ao robô;
--  (2) RD-69/70 (LGPD): área sem DEMO mapeada -> NÃO dispara (nunca fotografa empresa real), devolve erro claro;
--  (3) grants preservados (service_role + postgres; nunca anon/authenticated).
-- A área 'projetos' (tela /dashboard/projetos/calculadora) ganha a DEMO da Construtora Modelo logo abaixo, para
-- a Calculadora entrar na auditoria (hoje ficava "sem_demo").
--
-- Plano de volta (rollback): restaurar a definição anterior de fn_auditor_disparar(text) a partir do histórico
-- (versão que mandava só { rota }); e DELETE da linha ('projetos', ...) em demo_por_area, se preciso.

-- (1) área 'projetos' -> DEMO Construtora Modelo (a mesma do 'hub'); aditivo, só se a DEMO existir (is_demo).
INSERT INTO public.demo_por_area (area, company_id)
SELECT 'projetos', d.company_id
FROM public.demo_por_area d
JOIN public.companies c ON c.id = d.company_id AND c.is_demo = true
WHERE d.area = 'hub_construcao'
ON CONFLICT DO NOTHING;

-- (2) disparo de 1 rota passa a mandar empresa_id (DEMO da área), como o lote faz.
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

  -- RD-69/70 (LGPD): o robô só fotografa empresa de demonstração. Sem DEMO para a área -> não dispara.
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Área sem empresa de demonstração mapeada (RD-69/70): o robô não fotografa empresa real',
      'rota', p_rota,
      'area', v_area,
      'screen_id', v_screen_id,
      'acao', 'Mapear a área em demo_por_area (fn_demo_da_area) antes de auditar esta rota'
    );
  END IF;

  -- Disparar Playwright (agora COM empresa_id, igual ao lote)
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

  -- Disparar Insight Auditor em paralelo (analisa quando o screenshot novo estiver pronto)
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

-- (3) grants preservados: só service_role (o cron/rotina) e o dono (postgres). Nunca anon/authenticated.
REVOKE ALL ON FUNCTION public.fn_auditor_disparar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_disparar(text) TO service_role;
