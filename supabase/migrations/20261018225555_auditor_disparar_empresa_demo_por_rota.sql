-- Ferramenta do Code-Auditor (eng-chefe-auto) — conserto da via POR ROTA do auditor visual.
--
-- DEFEITO PROVADO NO DADO (RD-38), plantão 18/10:
--   fn_auditor_disparar('/dashboard/projetos/acompanhamento') (rota "crua", sem company_id) →
--   net._http_response id 1636 = 403 {"error":"empresa não é de demonstração — o robô/auditor só
--   opera em companies.is_demo=true","empresa_id":""}. O corpo do POST só mandava {rota}, SEM
--   empresa_id, então o screen-watcher recusava e a tela ficava "não auditada" — em silêncio.
--   É a causa de "o % do Hub não reflete o avanço": telas corrigidas (ex.: #2774 Acompanhamento)
--   não eram refotografadas pela via por rota e seguiam com a nota antiga do estado quebrado.
--   A MESMA chamada COM ?company_id=<DEMO> capturou a foto em ~6 s (id 1641) — prova do conserto.
--
-- O QUE MUDA (ADITIVO no comportamento): fn_auditor_disparar passa a RESOLVER sozinha a empresa
-- DEMO — company_id já embutido na rota (validado is_demo), senão a DEMO da ÁREA da tela
-- (fn_demo_da_area) — e envia 'empresa_id' no corpo, igual à fn_disparar_playwright_batch que já
-- funciona. Área sem DEMO → devolve nao_auditavel SEM disparar (nunca 403 silencioso, nunca nota 0,
-- alinhado ao "robô sem login = não auditada"). Nada muda para quem já passava ?company_id= (matriz).
--
-- GUARDA (check-fn-guards regra 4, que reprovou as #2816/#2826): só service_role/cron (sem usuário)
-- ou admin da PS podem disparar. REVOKE ALL FROM anon abaixo (regra 1). A função grava só em
-- system_screens (catálogo de telas, sem dado de cliente) ao cadastrar rota nova.
--
-- SEGREDO: o header x-watcher-secret é mantido IDÊNTICO à definição VIVA (lido com pg_get_functiondef
-- antes de reescrever — RD-94.1/C) e ao literal já versionado em 3 migrations antigas; esta PR NÃO
-- altera a forma como o segredo é guardado. Tirar o literal para o cofre (fn_watcher_secret() ainda
-- NÃO existe no banco vivo) é tarefa à parte (follow-up da #2829) e fica de fora de propósito: é
-- mudança adjacente a autenticação/cofre e esta é uma sessão de rotina não assistida (RD-97).
--
-- RD-97: CREATE OR REPLACE de mesma assinatura (sem DROP, sem renomear, sem tocar dado de cliente,
-- financeiro, fiscal, RLS). ROLLBACK: recriar fn_auditor_disparar com o corpo anterior (era #2846:
-- POST com body {rota} e sem a guarda/resolução de empresa).

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
