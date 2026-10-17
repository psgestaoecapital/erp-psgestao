-- Ferramenta do Code-Auditor (eng-chefe-auto): a FOTO do Hub volta 403 e a rota fica "não auditada".
--
-- CAUSA (provada no código, RD-38): fn_auditor_disparar faz POST para /api/screen-watcher/playwright
-- com o corpo { "rota": <rota> } APENAS — sem empresa_id e sem "?company_id=" na rota. No endpoint,
-- empresaDoPedidoRobo(body.empresa_id, rotas) devolve '' (corpo vazio + rota sem query), e a checagem
-- fail-closed empresaPermitidaParaRobo(supabase, '') recusa com HTTP 403 (MSG_ROBO_SO_DEMO). Resultado:
-- nenhum screenshot é capturado para as telas do Hub (e de qualquer vertical disparada por esta função).
--
-- CONSERTO (ADITIVO, RD-97 — não altera dado de cliente):
-- 1) demo_por_area ganha o apelido 'projetos' -> DEMO do Hub (Construtora Modelo Demonstração …006),
--    porque as rotas do Hub são /dashboard/projetos/* e a 2ª parte do caminho é 'projetos' (não 'hub').
--    INSERT guardado por is_demo=true, ON CONFLICT DO NOTHING (sem UPDATE/DELETE).
-- 2) fn_auditor_disparar passa a DERIVAR a empresa DEMO da área da rota (2º segmento do caminho) via
--    fn_demo_da_area e a mandar empresa_id no corpo do POST. Se a área não tiver DEMO cadastrada,
--    v_empresa_id fica NULL e o corpo sai sem empresa_id — mesmo comportamento de hoje (sem regressão).
-- Única linha funcional alterada: o jsonb do corpo do http_post (ganha empresa_id). Todo o resto é igual
-- à definição VIVA (SECURITY DEFINER + SET search_path='public' preservados).
--
-- Plano de volta (rollback): restaurar a versão anterior de fn_auditor_disparar (corpo { 'rota', p_rota })
-- e, se desejado, DELETE FROM demo_por_area WHERE area='projetos'. A linha de apelido é inócua por si só.
--
-- Teste: validar numa vaga (branch) do Supabase com um disparo real na DEMO do Hub, NUNCA em produção
-- (incidente de 03/10). Esperado: o POST passa a levar empresa_id e o 403 "só demonstração" some para
-- /dashboard/projetos/*. A nota de IA (score_visual/funcional) depende do budget do insight-auditor,
-- que é controle de custo à parte (RD-42) e não é tocado aqui.

INSERT INTO public.demo_por_area (area, company_id)
SELECT v.area, v.company_id::uuid
FROM (VALUES
  ('projetos', 'b0700000-0000-4000-a000-000000000006')
) AS v(area, company_id)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v.company_id::uuid AND c.is_demo = true)
ON CONFLICT DO NOTHING;

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
  v_empresa_id uuid;
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

  -- Empresa DEMO pela área da rota (2º segmento: /dashboard/<area>/...). Fail-safe: NULL se não houver DEMO.
  v_area := NULLIF(SPLIT_PART(TRIM(LEADING '/' FROM v_rota_base), '/', 2), '');
  v_empresa_id := fn_demo_da_area(v_area);

  -- Corpo do disparo: manda empresa_id só quando resolvido (sem isso o endpoint cai no 403 "só demonstração").
  v_body := jsonb_build_object('rota', p_rota);
  IF v_empresa_id IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('empresa_id', v_empresa_id);
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
    'empresa_id', v_empresa_id,
    't0', v_t0,
    'request_id_playwright', v_request_id_playwright,
    'insight_dispatch', v_insight_dispatch,
    'instrucao_caller', 'Aguarde 60-90s e chame fn_auditor_consultar(rota, t0) para ver resultado'
  );
END;
$function$;

-- Guarda da função (check_fn_guards): SECURITY DEFINER só de disparo, nunca aberta ao anon.
-- Preserva os grants VIVOS (service_role; o owner postgres mantém o próprio).
REVOKE ALL ON FUNCTION public.fn_auditor_disparar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_auditor_disparar(text) TO service_role;
