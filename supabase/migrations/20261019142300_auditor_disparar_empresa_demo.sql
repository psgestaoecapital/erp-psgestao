-- Hub HBF / PDCA (eng-chefe-auto 17/10) — ferramenta do Code-Auditor: a foto do auditor voltava 403 e o run
-- ficava "pending". Consolida numa só PR as tentativas paralelas #2816 e #2826 (ambas fechadas) e fecha o
-- check_fn_guards que barrou a #2826 (Eng. Chefe 17/10).
--
-- Causa (prova no dado — RD-38):
--   1) fn_auditor_disparar postava { rota } SEM empresa_id. O endpoint /api/screen-watcher/playwright resolve a
--      empresa pelo corpo OU por ?company_id= na rota; sem nenhum dos dois cai no 403 "só demonstração"
--      (RD-69/LGPD) e o Playwright nunca fotografa. O lote (fn_disparar_playwright_batch) já mandava empresa_id;
--      o disparo de rota única (usado também na camada 1 de fn_gold_disparar_jornada_completa) não mandava.
--   2) /dashboard/projetos/calculadora está em system_screens com area = 'projetos', que não tinha demo mapeada
--      em demo_por_area → fn_demo_da_area('projetos') = NULL → rota pulada como "sem_demo".
--
-- Correção (ADITIVA — RD-97): mapear 'projetos' para a DEMO do Hub (Construtora Modelo) e resolver a empresa
-- DEMO da área no disparo de rota única, mandando empresa_id no corpo — igual ao lote. Sem demo mapeada, a
-- função NÃO dispara (devolve 'sem_demo'), em vez de gerar um run que morre no 403. Nenhum comportamento de
-- cliente muda: afeta só o robô auditor e só empresa is_demo.
--
-- Plano de volta (rollback): reverter esta PR (código). No banco: CREATE OR REPLACE da versão anterior de
-- fn_auditor_disparar(text) (que mandava só { rota }) a partir do histórico, e
-- DELETE FROM public.demo_por_area WHERE area = 'projetos'. Ambos reversíveis, sem toque em dado de cliente.

-- ── 1) Área 'projetos' → DEMO do Hub (Construtora Modelo, b0700000-…-006, is_demo). PK é (area). ──
INSERT INTO public.demo_por_area (area, company_id)
SELECT 'projetos', d.company_id
FROM public.demo_por_area d
JOIN public.companies c ON c.id = d.company_id AND c.is_demo = true
WHERE d.area = 'hub_construcao'
ON CONFLICT (area) DO NOTHING;

-- ── 2) fn_auditor_disparar: resolve a empresa DEMO da área e manda empresa_id no corpo do Playwright. ──
-- ci-sem-guarda: fn_auditor_disparar — roda SÓ como serviço/agente (robô auditor; grants só service_role),
--   nunca com usuário logado; grava apenas no CATÁLOGO global system_screens (metadado de tela, sem dono nem
--   company_id de cliente) e só DISPARA foto contra empresa is_demo resolvida por fn_demo_da_area + a trava
--   explícita is_demo abaixo (RD-69/LGPD/RD-97). Não há "empresa do registro" a conferir — fn__guarda_empresa
--   não se aplica a função de serviço sem usuário.
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
BEGIN
  v_rota_base := SPLIT_PART(p_rota, '?', 1);
  v_screen_id_gerado := REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g');

  -- Garantir rota cadastrada (e guardar a área, para o lote baseline também achar a DEMO depois)
  SELECT id, area INTO v_screen_id, v_area FROM system_screens WHERE rota = v_rota_base;
  IF v_screen_id IS NULL THEN
    SELECT area_id INTO v_area FROM fn_resolver_area_da_rota(v_rota_base) LIMIT 1;
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
  ELSIF v_area IS NULL THEN
    SELECT area_id INTO v_area FROM fn_resolver_area_da_rota(v_rota_base) LIMIT 1;
  END IF;

  -- Empresa DEMO da área (RD-69/LGPD: o robô só fotografa is_demo). Sem demo mapeada → NÃO dispara:
  -- evita o 403 e o run "pending" eterno; sinaliza para mapear a área antes de auditar a rota.
  v_empresa := fn_demo_da_area(v_area);
  IF v_empresa IS NULL THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'area sem demo mapeada',
      'rota', p_rota,
      'area', v_area,
      'instrucao_caller', 'Mapear a área em demo_por_area (empresa is_demo) antes de auditar esta rota'
    );
  END IF;

  -- RD-97/RD-69/LGPD (trava explícita, defesa em profundidade): a empresa alvo TEM de ser de demonstração.
  -- fn_demo_da_area já filtra is_demo; esta trava recusa EXPLICITAMENTE qualquer empresa que não seja DEMO,
  -- para o disparo nunca fotografar empresa real mesmo que um mapeamento futuro erre.
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_empresa AND is_demo = true) THEN
    RETURN jsonb_build_object(
      'sucesso', false,
      'erro', 'empresa alvo nao e de demonstracao (RD-97/LGPD): disparo recusado',
      'rota', p_rota,
      'area', v_area,
      'empresa_id', v_empresa
    );
  END IF;

  -- Disparar Playwright (manda a empresa DEMO no corpo — sem isso o run caía no 403 e ficava pending)
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

-- ── 3) Guarda de execução (check-fn-guards · RD-97): SECURITY DEFINER só pelo papel de serviço/agentes. ──
-- Idempotente (os grants vivos já são só service_role/postgres); deixa a trava explícita para o db push.
REVOKE ALL ON FUNCTION public.fn_auditor_disparar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_disparar(text) TO service_role;
