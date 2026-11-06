-- Conserto da main vermelha (gate check-auditor-disparar-demo), gilberto-desenv 23/10.
--
-- DEFEITO (RD-38, provado no dado e no repo): a #2863 (20261022222955) reescreveu fn_auditor_disparar para resolver a
-- DEMO também pela rota e, no caminho, DERRUBOU a trava explícita `is_demo = true` antes do http_post (defesa em
-- profundidade da 20261019142300, RD-97/LGPD) e o comentário ci-sem-guarda. A definição VIVA (pg_get_functiondef,
-- lida antes de reescrever — RD-94.1/C) é idêntica ao arquivo da #2863. Hoje o efeito é seguro (fn_demo_da_area e o
-- ramo company_id filtram is_demo), mas um mapeamento futuro errado em demo_por_area faria o robô fotografar empresa
-- real sem nenhuma barreira na própria função.
--
-- O QUE MUDA: SÓ a trava explícita volta (empresa não-DEMO → devolve nao_auditavel SEM disparar). O resto do corpo é
-- byte a byte o da definição viva (mesmo segredo, mesma guarda de papel, mesma resolução de empresa). Mesma assinatura,
-- sem DROP, sem dado de cliente. ROLLBACK: reaplicar o corpo da 20261022222955.

-- ci-sem-guarda: fn_auditor_disparar — roda como serviço/agente (robô auditor; grants só service_role) ou admin da PS
--   (guarda de papel no início do corpo); grava apenas no CATÁLOGO global system_screens (metadado de tela, sem dono nem
--   company_id de cliente) e só DISPARA foto contra empresa is_demo (fn_demo_da_area / company_id DEMO da rota + a
--   trava explícita is_demo abaixo, RD-69/LGPD/RD-97). Não há "empresa do registro" a conferir.
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
  v_empresa uuid;
  v_company_na_rota text;
BEGIN
  -- Guarda (check-fn-guards regra 4): só service_role/cron (sem usuário) ou admin da PS.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'sem permissão para disparar o auditor' USING ERRCODE = '42501';
  END IF;

  v_rota_base := SPLIT_PART(p_rota, '?', 1);
  v_screen_id_gerado := REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g');

  -- Garantir rota cadastrada, herdando a ÁREA da rota-pai (p/ fn_demo_da_area resolver a DEMO).
  SELECT id, area INTO v_screen_id, v_area FROM system_screens WHERE rota = v_rota_base;
  IF v_screen_id IS NULL THEN
    SELECT s.area INTO v_area FROM system_screens s
    WHERE v_rota_base LIKE s.rota || '/%' AND s.area IS NOT NULL
    ORDER BY length(s.rota) DESC LIMIT 1;
    INSERT INTO system_screens (id, rota, area, titulo, estado_real, prioridade_monitoramento)
    VALUES (
      v_screen_id_gerado,
      v_rota_base,
      v_area,
      INITCAP(REPLACE(REGEXP_REPLACE(v_rota_base, '^/dashboard/', ''), '-', ' ')),
      'desconhecida',
      'alta'
    )
    RETURNING id INTO v_screen_id;
  END IF;

  -- RD-69/70 (LGPD): o robô só fotografa empresa de demonstração.
  -- (1) company_id já na rota (quem chamou já resolveu) desde que seja DEMO; (2) senão, a DEMO da área.
  v_company_na_rota := (regexp_match(p_rota, 'company_id=([0-9a-fA-F-]{36})'))[1];
  IF v_company_na_rota IS NOT NULL
     AND EXISTS (SELECT 1 FROM companies c WHERE c.id = v_company_na_rota::uuid AND c.is_demo) THEN
    v_empresa := v_company_na_rota::uuid;
  ELSE
    v_empresa := public.fn_demo_da_area(v_area);
  END IF;

  -- Área sem DEMO mapeada → NÃO dispara (o watcher recusaria com 403). "não auditável", nunca nota 0.
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'nao_auditavel', true,
      'rota', p_rota,
      'rota_base', v_rota_base,
      'area', v_area,
      'erro', 'área sem empresa de demonstração (RD-69/70) — tela não auditável; mapear em demo_por_area'
    );
  END IF;

  -- RD-97/RD-69/LGPD (trava explícita, defesa em profundidade — restaurada): a empresa alvo TEM de ser de
  -- demonstração. fn_demo_da_area e o ramo company_id já filtram is_demo; esta trava recusa EXPLICITAMENTE qualquer
  -- empresa que não seja DEMO, para o disparo nunca fotografar empresa real mesmo que um mapeamento futuro erre.
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_empresa AND is_demo = true) THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'nao_auditavel', true,
      'rota', p_rota,
      'rota_base', v_rota_base,
      'area', v_area,
      'empresa_id', v_empresa,
      'erro', 'empresa alvo não é de demonstração (RD-97/LGPD): disparo recusado'
    );
  END IF;

  -- Disparar Playwright SEMPRE com empresa_id (DEMO) no corpo — senão o watcher devolve 403 (silencioso).
  BEGIN
    SELECT net.http_post(
      url := 'https://erp-psgestao.vercel.app/api/screen-watcher/playwright',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
      ),
      body := jsonb_build_object('rota', v_rota_base, 'empresa_id', v_empresa),
      timeout_milliseconds := 90000
    ) INTO v_request_id_playwright;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'Falha disparar Playwright: ' || SQLERRM,
      'rota', p_rota
    );
  END;

  -- Insight Auditor em paralelo (analisa quando o screenshot estiver pronto).
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

REVOKE ALL ON FUNCTION public.fn_auditor_disparar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_disparar(text) TO service_role;
