-- Auditor por área (fn_auditor_matriz_*) — conserto (CEO 01/10, auditoria do Hub de Projetos).
-- Prova no dado (RD-38), run 23 (hub, Tryo Gesso): 10 rotas "pending" para sempre + 1 "erro".
--  1) As 10 "pending": o robô respondeu 403 "empresa não é de demonstração" (net._http_response 339–347) — o disparo
--     manda só { rota } e a empresa ia dentro da rota (?company_id=), que o robô não lia → empresa vazia → 403. E a
--     Tryo não é demo: o robô só fotografa empresa de demonstração (RD-69/70, LGPD). O WATCHER_SECRET NÃO é a causa:
--     segredo errado daria 401, e veio 403 (o segredo confere).
--     Conserto: (a) a rota do robô passa a ler o company_id da rota (empresaDoPedidoRobo, no código); (b) aqui, a
--     empresa pedida que não é demo é TROCADA pela demo da área (fn_demo_da_area) e isso fica escrito na observação
--     do run; área sem demo → a tela vira "erro: não auditável", nunca foto de cliente.
--  2) Ninguém olhava a resposta do robô: 403/500 ficavam "pending" para sempre. Agora o consultar lê
--     net._http_response: status ≠ 200 ou captura sem sucesso → "erro" com o motivo; > 20 min sem resultado →
--     "timeout" (conferido ANTES de consultar o insight, para não marcar "completo" com foto velha).
--  3) Ninguém consultava: o consultar só rodava se alguém chamasse à mão. Agora um cron a cada 5 min consulta os runs
--     abertos do último dia (fn_auditor_matriz_consultar_pendentes, só service_role).
--  4) "null value in column area of relation system_screens" (Simulador): fn_auditor_disparar cadastra a tela nova
--     sem "area". Sem reescrever fn_auditor_disparar (tem o segredo dentro — não passa por PR), a tela é cadastrada
--     ANTES pelo disparo da matriz, com a área da rota-mãe mais próxima já cadastrada (fallback: a área pedida).
--     E "hub_construcao" (área das telas /dashboard/projetos) ganha a demo em demo_por_area (= a demo do "hub").
--  5) Run 22 (pm, 25/09) sem resultados: p_apenas_status chegou NULL → "status = ANY(NULL)" não casa nada. Agora
--     NULL = padrão (pronto, parcial); 'todos' = todas as telas do menu; 'sem_status' = módulos sem selo.
--  6) Runs antigos parados (2, 3, 6–21, 23) são fechados pelo próprio consultar novo (timeout/erro com motivo) —
--     nada é apagado (RD-30).

-- 4) demo da área hub_construcao = a mesma da área hub
INSERT INTO public.demo_por_area (area, company_id)
SELECT 'hub_construcao', d.company_id FROM public.demo_por_area d
WHERE d.area = 'hub'
  AND NOT EXISTS (SELECT 1 FROM public.demo_por_area x WHERE x.area = 'hub_construcao');

-- 1, 4, 5) disparo
CREATE OR REPLACE FUNCTION public.fn_auditor_matriz_disparar(
  p_area_id text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_apenas_status text[] DEFAULT ARRAY['pronto'::text, 'parcial'::text],
  p_modulos_filter text[] DEFAULT NULL::text[],
  p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id BIGINT;
  v_modulo RECORD;
  v_rota_completa TEXT;
  v_rota_base TEXT;
  v_disparado JSONB;
  v_total INTEGER := 0;
  v_rotas_disparadas JSONB := '[]'::JSONB;
  v_status text[] := COALESCE(p_apenas_status, ARRAY['pronto','parcial']);
  v_empresa uuid;
  v_obs text := p_observacao;
  v_area_tela text;
BEGIN
  -- só service_role/cron (sem usuário) ou administrador da PS
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'sem permissão para disparar o auditor' USING ERRCODE = '42501';
  END IF;

  -- RD-69/70 (LGPD): o robô só fotografa empresa de demonstração. Empresa pedida que não é demo → demo da área.
  IF p_company_id IS NOT NULL AND EXISTS (SELECT 1 FROM companies c WHERE c.id = p_company_id AND c.is_demo) THEN
    v_empresa := p_company_id;
  ELSE
    v_empresa := public.fn_demo_da_area(p_area_id);
    IF p_company_id IS NOT NULL THEN
      v_obs := concat_ws(' · ', v_obs, format('empresa pedida %s não é de demonstração (RD-69/70) → auditado na demo %s',
                                              p_company_id, COALESCE(v_empresa::text, '(nenhuma demo para a área)')));
    END IF;
  END IF;

  INSERT INTO erp_auditor_matriz_runs (area_id, company_id, modo, filtro_status, observacao, trigger_origin, user_id)
  VALUES (p_area_id, v_empresa, 'manual', v_status, v_obs, 'fn_auditor_matriz_disparar', auth.uid())
  RETURNING id INTO v_run_id;

  FOR v_modulo IN
    WITH modulos_distintos AS (
      SELECT DISTINCT ON (m.modulo_id) m.modulo_id, m.nome, m.rota, m.status, m.ordem
      FROM fn_modulos_sidebar_por_area(p_area_id) m
      WHERE ('todos' = ANY(v_status) OR m.status = ANY(v_status) OR (m.status IS NULL AND 'sem_status' = ANY(v_status)))
        AND m.rota IS NOT NULL
        AND m.rota NOT LIKE '%#%'
        AND (p_modulos_filter IS NULL OR m.modulo_id = ANY(p_modulos_filter))
    )
    SELECT modulo_id, nome, rota, status FROM modulos_distintos ORDER BY ordem
  LOOP
    v_rota_base := SPLIT_PART(v_modulo.rota, '?', 1);
    v_rota_completa := v_modulo.rota;
    IF v_empresa IS NOT NULL THEN
      v_rota_completa := v_rota_completa || CASE WHEN v_rota_completa LIKE '%?%' THEN '&' ELSE '?' END
                         || 'company_id=' || v_empresa::text;
    END IF;

    -- área sem demo: não dispara (o robô recusaria) — registra como não auditável
    IF v_empresa IS NULL THEN
      INSERT INTO erp_auditor_matriz_resultados (run_id, modulo_id, modulo_nome, rota_base, rota_completa,
        status_modulo_catalogo, t0_dispatch, status, bugs_detectados)
      VALUES (v_run_id, v_modulo.modulo_id, v_modulo.nome, v_rota_base, v_rota_completa, v_modulo.status, NOW(), 'erro',
        ARRAY['não auditável: a área "' || p_area_id || '" não tem empresa de demonstração (RD-69/70)']::TEXT[])
      ON CONFLICT (run_id, modulo_id) DO NOTHING;
      CONTINUE;
    END IF;

    BEGIN
      -- tela ainda não cadastrada: cadastra com a área (fn_auditor_disparar cadastraria sem "area" e quebraria)
      IF NOT EXISTS (SELECT 1 FROM system_screens s WHERE s.rota = v_rota_base) THEN
        SELECT s.area INTO v_area_tela FROM system_screens s
        WHERE v_rota_base LIKE s.rota || '/%' AND s.area IS NOT NULL
        ORDER BY length(s.rota) DESC LIMIT 1;
        INSERT INTO system_screens (id, rota, area, titulo, estado_real, prioridade_monitoramento)
        VALUES (REGEXP_REPLACE(TRIM(LEADING '/' FROM v_rota_base), '/', '.', 'g'), v_rota_base,
                COALESCE(v_area_tela, p_area_id), COALESCE(NULLIF(v_modulo.nome, ''), v_rota_base),
                'desconhecida', 'alta')
        ON CONFLICT DO NOTHING;
      END IF;

      v_disparado := fn_auditor_disparar(v_rota_completa);
      IF COALESCE((v_disparado->>'sucesso')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION '%', COALESCE(v_disparado->>'erro', 'disparo sem sucesso');
      END IF;

      INSERT INTO erp_auditor_matriz_resultados (run_id, modulo_id, modulo_nome, rota_base, rota_completa,
        screen_id, status_modulo_catalogo, t0_dispatch, status, request_id_playwright, request_id_insight)
      VALUES (v_run_id, v_modulo.modulo_id, v_modulo.nome, v_rota_base, v_rota_completa,
        v_disparado->>'screen_id', v_modulo.status, (v_disparado->>'t0')::TIMESTAMPTZ, 'pending',
        (v_disparado#>>'{request_id_playwright}')::BIGINT, (v_disparado#>>'{insight_dispatch,request_id}')::BIGINT)
      ON CONFLICT (run_id, modulo_id) DO NOTHING;

      v_total := v_total + 1;
      v_rotas_disparadas := v_rotas_disparadas || jsonb_build_object(
        'modulo_id', v_modulo.modulo_id, 'nome', v_modulo.nome, 'rota_completa', v_rota_completa, 't0', v_disparado->>'t0');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO erp_auditor_matriz_resultados (run_id, modulo_id, modulo_nome, rota_base, rota_completa,
        status_modulo_catalogo, t0_dispatch, status, bugs_detectados)
      VALUES (v_run_id, v_modulo.modulo_id, v_modulo.nome, v_rota_base, v_rota_completa,
        v_modulo.status, NOW(), 'erro', ARRAY['Erro ao disparar: ' || SQLERRM]::TEXT[])
      ON CONFLICT (run_id, modulo_id) DO NOTHING;
    END;
  END LOOP;

  UPDATE erp_auditor_matriz_runs
  SET total_modulos = (SELECT count(*) FROM erp_auditor_matriz_resultados WHERE run_id = v_run_id),
      resultados_processando = v_total,
      resultados_falharam = (SELECT count(*) FROM erp_auditor_matriz_resultados WHERE run_id = v_run_id AND status = 'erro'),
      custo_estimado_usd = (v_total * 0.013)::NUMERIC(5,4)
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id, 'area_id', p_area_id, 'company_id', v_empresa, 'company_id_pedida', p_company_id,
    'observacao', v_obs, 'total_disparados', v_total, 'custo_estimado_usd', (v_total * 0.013),
    'rotas_disparadas', v_rotas_disparadas, 'iniciado_em', NOW(),
    'instrucao', 'O cron consulta a cada 5 min; para ver já: fn_auditor_matriz_consultar(' || v_run_id || ')');
END $function$;
REVOKE ALL ON FUNCTION public.fn_auditor_matriz_disparar(text, uuid, text[], text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_matriz_disparar(text, uuid, text[], text[], text) TO service_role;

-- 2) consulta: lê a resposta do robô, timeout de 20 min, fecha o run
CREATE OR REPLACE FUNCTION public.fn_auditor_matriz_consultar(p_run_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run RECORD;
  v_resultado RECORD;
  v_consulta JSONB;
  v_http_status integer;
  v_http_content text;
  v_http_erro text;
  v_qtd INTEGER := 0;
  v_insight_em timestamptz;
  v_disp JSONB;
  v_corpo JSONB;
  v_ok INTEGER := 0;
  v_com_bug INTEGER := 0;
  v_processando INTEGER := 0;
  v_falharam INTEGER := 0;
  v_score numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'sem permissão para consultar o auditor' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run FROM erp_auditor_matriz_runs WHERE id = p_run_id;
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Run ID nao encontrado', 'run_id', p_run_id);
  END IF;

  FOR v_resultado IN
    SELECT * FROM erp_auditor_matriz_resultados WHERE run_id = p_run_id AND status = 'pending'
  LOOP
    BEGIN
      -- a) o robô já respondeu com erro? (403 não-demo, 401 segredo, 500, captura sem sucesso)
      v_http_status := NULL; v_http_content := NULL; v_http_erro := NULL;
      IF v_resultado.request_id_playwright IS NOT NULL THEN
        SELECT h.status_code, h.content, h.error_msg INTO v_http_status, v_http_content, v_http_erro
        FROM net._http_response h WHERE h.id = v_resultado.request_id_playwright;
      END IF;
      IF v_http_status IS NOT NULL AND v_http_status <> 200 THEN
        UPDATE erp_auditor_matriz_resultados
        SET status = 'erro', consultado_em = NOW(),
            bugs_detectados = ARRAY['robô respondeu HTTP ' || v_http_status || ': ' || left(COALESCE(v_http_content, ''), 300)]::TEXT[]
        WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
        CONTINUE;
      END IF;
      IF v_http_status = 200 THEN
        BEGIN v_corpo := v_http_content::jsonb; EXCEPTION WHEN OTHERS THEN v_corpo := NULL; END;
        IF v_corpo IS NOT NULL AND (v_corpo->>'success') = 'false' THEN
          UPDATE erp_auditor_matriz_resultados
          SET status = 'erro', consultado_em = NOW(),
              bugs_detectados = ARRAY['robô não fotografou (' || COALESCE(v_corpo->>'capture_status', '?') || '): '
                                      || left(COALESCE(v_corpo->>'motivo', v_corpo->>'error', ''), 300)]::TEXT[]
          WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
          CONTINUE;
        END IF;
      END IF;

      -- b) parado há mais de 20 min → timeout (antes de consultar, para não fechar com foto/análise velha)
      IF v_resultado.t0_dispatch IS NULL OR v_resultado.t0_dispatch < NOW() - interval '20 minutes' THEN
        UPDATE erp_auditor_matriz_resultados
        SET status = 'timeout', consultado_em = NOW(),
            bugs_detectados = ARRAY['sem resultado em 20 min' || CASE WHEN v_http_erro IS NOT NULL
                                    THEN ' (robô: ' || left(v_http_erro, 200) || ')' ELSE '' END]::TEXT[]
        WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
        CONTINUE;
      END IF;

      -- c) foto + análise da IA depois do disparo
      v_consulta := fn_auditor_consultar(v_resultado.rota_base, v_resultado.t0_dispatch);
      -- análise anterior à foto nova = análise da foto VELHA (o insight é chamado junto com o disparo, antes de a
      -- foto existir) → não vale; segue aguardando a análise da foto nova
      IF v_consulta->>'status' = 'completo'
         AND (v_consulta#>>'{analise,analisado_em}')::timestamptz <= (v_consulta->>'screenshot_em')::timestamptz THEN
        v_consulta := jsonb_set(v_consulta, '{status}', '"aguardando_insight_ia"');
      END IF;
      -- foto nova pronta e a chamada da IA foi feita antes dela ("Nenhuma tela elegível") → chama a IA de novo, 1 vez
      IF v_consulta->>'status' = 'aguardando_insight_ia' THEN
        v_insight_em := NULL;
        IF v_resultado.request_id_insight IS NOT NULL THEN
          SELECT h.created INTO v_insight_em FROM net._http_response h WHERE h.id = v_resultado.request_id_insight;
        END IF;
        IF v_resultado.request_id_insight IS NULL
           OR (v_insight_em IS NOT NULL AND v_insight_em < (v_consulta->>'screenshot_em')::timestamptz) THEN
          v_disp := fn_disparar_insight_auditor(p_rota := v_resultado.rota_base, p_limit := 1);
          UPDATE erp_auditor_matriz_resultados SET request_id_insight = (v_disp->>'request_id')::bigint
          WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
        END IF;
      END IF;
      IF v_consulta->>'status' = 'completo' THEN
        UPDATE erp_auditor_matriz_resultados
        SET status = 'completo', consultado_em = NOW(),
            score_pct = (v_consulta#>>'{analise,score_pct}')::numeric::INTEGER,
            bugs_detectados = (SELECT array_agg(value::TEXT) FROM jsonb_array_elements_text(v_consulta#>'{analise,bugs_detectados}')),
            recomendacoes = (SELECT array_agg(value::TEXT) FROM jsonb_array_elements_text(v_consulta#>'{analise,recomendacoes}')),
            proximo_passo = v_consulta#>>'{analise,proximo_passo}',
            screenshot_url = v_consulta->>'screenshot_url',
            tempo_decorrido_segundos = (v_consulta->>'tempo_decorrido_segundos')::INTEGER
        WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
      ELSIF v_consulta->>'status' = 'erro' THEN
        UPDATE erp_auditor_matriz_resultados
        SET status = 'erro', consultado_em = NOW(), bugs_detectados = ARRAY[COALESCE(v_consulta->>'erro', 'erro na consulta')]::TEXT[]
        WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
      ELSE
        UPDATE erp_auditor_matriz_resultados
        SET screenshot_url = COALESCE(v_consulta->>'screenshot_url', screenshot_url),
            tempo_decorrido_segundos = (v_consulta->>'tempo_decorrido_segundos')::INTEGER
        WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE erp_auditor_matriz_resultados
      SET status = 'erro', bugs_detectados = ARRAY['Erro ao consultar auditor: ' || SQLERRM]::TEXT[]
      WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
    END;
  END LOOP;

  SELECT
    COUNT(*) FILTER (WHERE status = 'completo' AND COALESCE(score_pct, 0) >= 50),
    COUNT(*) FILTER (WHERE status = 'completo' AND COALESCE(score_pct, 0) < 50),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status IN ('erro', 'timeout')),
    AVG(score_pct) FILTER (WHERE status = 'completo' AND score_pct IS NOT NULL),
    COUNT(*)
  INTO v_ok, v_com_bug, v_processando, v_falharam, v_score, v_qtd
  FROM erp_auditor_matriz_resultados WHERE run_id = p_run_id;

  UPDATE erp_auditor_matriz_runs
  SET resultados_ok = v_ok, resultados_com_bug = v_com_bug, resultados_processando = v_processando,
      resultados_falharam = v_falharam, score_medio = v_score,
      status = CASE
        WHEN v_processando = 0 AND v_ok + v_com_bug = 0 THEN 'falhou'   -- nada auditado (tudo erro/timeout, ou nenhuma tela casou o filtro)
        WHEN v_processando = 0 THEN 'concluido'
        WHEN v_processando < total_modulos / 2 THEN 'parcial'
        ELSE 'em_andamento'
      END,
      concluido_em = CASE WHEN v_processando = 0 THEN COALESCE(concluido_em, NOW()) ELSE NULL END,
      tempo_total_segundos = CASE WHEN v_processando = 0 THEN EXTRACT(EPOCH FROM (COALESCE(concluido_em, NOW()) - iniciado_em))::INTEGER ELSE NULL END
  WHERE id = p_run_id;

  SELECT * INTO v_run FROM erp_auditor_matriz_runs WHERE id = p_run_id;
  RETURN jsonb_build_object(
    'run_id', p_run_id, 'area_id', v_run.area_id, 'company_id', v_run.company_id, 'status', v_run.status,
    'iniciado_em', v_run.iniciado_em, 'concluido_em', v_run.concluido_em,
    'tempo_segundos', EXTRACT(EPOCH FROM (NOW() - v_run.iniciado_em))::INTEGER,
    'total_modulos', v_run.total_modulos, 'resultados_ok', v_ok, 'resultados_com_bug', v_com_bug,
    'resultados_processando', v_processando, 'resultados_falharam', v_falharam, 'score_medio', v_score,
    'instrucao', CASE WHEN v_processando = 0
      THEN 'CONCLUIDO - chame fn_auditor_matriz_briefing(' || p_run_id || ') para relatorio executivo'
      ELSE 'Em andamento. ' || v_processando || ' modulos ainda processando (o cron consulta a cada 5 min).' END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_auditor_matriz_consultar(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_matriz_consultar(bigint) TO service_role;

-- 3) cron: consulta os runs abertos do último dia
CREATE OR REPLACE FUNCTION public.fn_auditor_matriz_consultar_pendentes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM erp_auditor_matriz_runs
           WHERE status IN ('em_andamento', 'parcial') AND iniciado_em > NOW() - interval '1 day' ORDER BY id
  LOOP
    PERFORM public.fn_auditor_matriz_consultar(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.fn_auditor_matriz_consultar_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auditor_matriz_consultar_pendentes() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auditor-matriz-consultar-5min') THEN
    PERFORM cron.unschedule('auditor-matriz-consultar-5min');
  END IF;
END $$;
SELECT cron.schedule('auditor-matriz-consultar-5min', '*/5 * * * *', $cron$ SELECT public.fn_auditor_matriz_consultar_pendentes(); $cron$);

-- 6) fecha os runs antigos parados (pending > 20 min vira timeout/erro com motivo; nada é apagado)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT run_id AS id FROM erp_auditor_matriz_resultados
           WHERE status = 'pending' AND t0_dispatch < NOW() - interval '20 minutes'
           UNION
           SELECT id FROM erp_auditor_matriz_runs WHERE status IN ('em_andamento', 'parcial') AND iniciado_em < NOW() - interval '20 minutes'
  LOOP
    PERFORM public.fn_auditor_matriz_consultar(r.id);
  END LOOP;
END $$;
