-- Auditor por área: quando a IA está pausada (limite de custo diário/mensal) o resultado ficava "pending" por 20 min
-- (fn_disparar_insight_auditor devolve {erro} sem request_id e a consulta seguia esperando) e o @pos-migration
-- auditor-matriz-conserto ficava vermelho na main. Agora a consulta fecha o resultado com o motivo (status 'erro').
-- Única mudança sobre a definição viva: o bloco "p_rota ... fn_disparar_insight_auditor" trata o retorno de erro.
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
          -- IA recusou o disparo (orçamento pausado/esgotado): sem request_id ela nunca vai responder → fecha com o motivo
          IF v_disp->>'request_id' IS NULL THEN
            UPDATE erp_auditor_matriz_resultados
            SET status = 'erro', consultado_em = NOW(),
                screenshot_url = COALESCE(v_consulta->>'screenshot_url', screenshot_url),
                bugs_detectados = ARRAY['análise de IA indisponível: ' || left(COALESCE(v_disp->>'erro', 'disparo sem request_id'), 200)
                                        || COALESCE(' (' || left(v_disp->>'motivo', 120) || ')', '')]::TEXT[]
            WHERE run_id = p_run_id AND modulo_id = v_resultado.modulo_id;
            CONTINUE;
          END IF;
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
