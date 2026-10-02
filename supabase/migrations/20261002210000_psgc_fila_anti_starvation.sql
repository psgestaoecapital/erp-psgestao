-- Fila PSGC (psgc_job_queue) — fim da starvation (diagnóstico do Eng. Chefe 02/10; lista do banco aprovada pelo CEO).
--
-- Provado no dado (02/10): cron 4 (fn_processar_respostas_sync → fn_etl_omie_empresa) re-upserta TODOS os títulos
-- Omie a cada 5 min com ultima_sync = NOW(). Cada UPDATE dispara trg_psgc_pagar/trg_psgc_receber, que enfileira
-- recalcular_dre_mes (+fluxo +abc) por empresa/mês — ~120 jobs/h só de Tryo Gesso, Tryo Acabamentos, R.R e M.m, sem
-- nenhuma mudança que afete a DRE. O worker (cron 6, lote 10, ORDER BY prioridade) fazia 120/h: dre_mes (prioridade 5)
-- tomava tudo e recalcular_fluxo / popular_dre_divisional / recalcular_abc ficaram parados desde 28/09 (12 empresas).
--
-- (1) Trigger só enfileira no UPDATE quando muda um campo que DRE/fluxo/ABC leem; se data_emissao troca de mês,
--     enfileira também o mês antigo. INSERT e DELETE seguem iguais. O ETL Omie não muda (ultima_sync segue valendo).
-- (2) Worker: anti-starvation — job esperando há mais de 30 min conta como prioridade 0 (desempate: o mais antigo).
-- (3) Worker: popular_dre_divisional que devolve success:false vira ERRO com a mensagem (antes: "concluído" calado).
-- (4) Cron 6: lote 10 → 50 (teto de 30 s por rodada mantido).
-- (5) Vigia: fn_psgc_fila_vigiar() — tipo com job pendente há mais de 1 h → briefing (alertas_pendentes_para_ceo).
-- Nada é apagado (RD-30).

-- ───────── (1) trigger: só mudança que importa ─────────
CREATE OR REPLACE FUNCTION public.trg_psgc_enfileirar_lancamento()
 RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_data date; v_data_old date; v_company uuid; v_ref text;
  -- campos que fn_psgc_recalcular_dre_mes / _fluxo / _abc leem (02/10); qualquer outro (ultima_sync, importado_em,
  -- updated_at, observação…) não muda o resultado → não enfileira
  c_campos constant text[] := ARRAY['company_id','data_emissao','data_pagamento','valor','valor_documento','valor_distribuido',
                                     'categoria','status','deleted_at','plano_conta_codigo','psgc_codigo','business_line_id','ln_id'];
  v_old jsonb; v_new jsonb; v_mudou boolean := false; k text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    FOREACH k IN ARRAY c_campos LOOP
      IF (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN v_mudou := true; EXIT; END IF;
    END LOOP;
    IF NOT v_mudou THEN RETURN NEW; END IF;
  END IF;

  v_company := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  v_ref := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
  v_data := fn_parse_data_text(CASE WHEN TG_OP = 'DELETE' THEN OLD.data_emissao::text ELSE NEW.data_emissao::text END);
  IF TG_OP = 'UPDATE' THEN v_data_old := fn_parse_data_text(OLD.data_emissao::text); END IF;

  IF v_data IS NOT NULL THEN
    PERFORM fn_psgc_enfileirar(v_company, 'recalcular_dre_mes', EXTRACT(YEAR FROM v_data)::int, EXTRACT(MONTH FROM v_data)::int, 5, 'trigger:' || TG_TABLE_NAME, v_ref);
    PERFORM fn_psgc_enfileirar(v_company, 'recalcular_abc', EXTRACT(YEAR FROM v_data)::int, NULL, 7, 'trigger:' || TG_TABLE_NAME);
    IF TG_TABLE_NAME IN ('erp_pagar', 'erp_receber') THEN
      PERFORM fn_psgc_enfileirar(v_company, 'recalcular_fluxo', EXTRACT(YEAR FROM v_data)::int, EXTRACT(MONTH FROM v_data)::int, 6, 'trigger:' || TG_TABLE_NAME);
    END IF;
  END IF;
  -- data_emissao mudou de mês (ou de empresa): o mês antigo também precisa ser refeito
  IF TG_OP = 'UPDATE' AND v_data_old IS NOT NULL
     AND (v_data IS NULL OR date_trunc('month', v_data_old) <> date_trunc('month', v_data) OR OLD.company_id IS DISTINCT FROM NEW.company_id) THEN
    PERFORM fn_psgc_enfileirar(OLD.company_id, 'recalcular_dre_mes', EXTRACT(YEAR FROM v_data_old)::int, EXTRACT(MONTH FROM v_data_old)::int, 5, 'trigger:' || TG_TABLE_NAME, v_ref);
    IF TG_TABLE_NAME IN ('erp_pagar', 'erp_receber') THEN
      PERFORM fn_psgc_enfileirar(OLD.company_id, 'recalcular_fluxo', EXTRACT(YEAR FROM v_data_old)::int, EXTRACT(MONTH FROM v_data_old)::int, 6, 'trigger:' || TG_TABLE_NAME);
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao enfileirar recálculo PSGC: %', SQLERRM;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- ───────── (2)+(3) worker: anti-starvation + erro que não se esconde ─────────
CREATE OR REPLACE FUNCTION public.fn_psgc_processar_fila(p_lote_max integer DEFAULT 50)
 RETURNS TABLE(jobs_processados integer, sucessos integer, erros integer, duracao_total_ms integer)
 LANGUAGE plpgsql AS $$
DECLARE
  v_job record; v_inicio timestamptz; v_fim timestamptz; v_duracao_ms int;
  v_sucessos int := 0; v_erros int := 0; v_total int := 0; v_duracao_agregada int := 0;
  v_inicio_batch timestamptz := clock_timestamp();
  v_max_batch_ms int := 30000;
  v_res jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '45000', true);

  FOR v_job IN
    SELECT * FROM psgc_job_queue
     WHERE status = 'pendente' AND tentativas < max_tentativas
     -- anti-starvation: esperando há mais de 30 min conta como prioridade 0; empate → o mais antigo primeiro
     ORDER BY CASE WHEN created_at < now() - interval '30 minutes' THEN 0 ELSE prioridade END ASC, created_at ASC
     LIMIT p_lote_max
     FOR UPDATE SKIP LOCKED
  LOOP
    IF EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio_batch)::int > v_max_batch_ms THEN EXIT; END IF;

    v_total := v_total + 1;
    v_inicio := clock_timestamp();
    UPDATE psgc_job_queue SET status = 'processando', started_at = v_inicio, tentativas = tentativas + 1 WHERE id = v_job.id;

    BEGIN
      CASE v_job.tipo
        WHEN 'recalcular_dre_mes' THEN PERFORM fn_psgc_recalcular_dre_mes(v_job.company_id, v_job.ano, v_job.mes);
        WHEN 'recalcular_abc' THEN PERFORM fn_psgc_recalcular_abc(v_job.company_id, v_job.ano, v_job.mes);
        WHEN 'recalcular_fluxo' THEN PERFORM fn_psgc_recalcular_fluxo(v_job.company_id, v_job.ano, v_job.mes);
        WHEN 'popular_dre_divisional' THEN
          -- a função engole o erro e devolve success:false — aqui isso vira erro de verdade (antes: "concluído" calado)
          v_res := fn_popular_dre_divisional_from_psgc(v_job.company_id, v_job.ano, v_job.mes);
          IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'popular_dre_divisional: %', COALESCE(v_res->>'error', 'success=false sem mensagem');
          END IF;
        WHEN 'mapear_plano_contas' THEN
          INSERT INTO psgc_depara (company_id, origem_codigo, origem_descricao, origem_sistema, psgc_codigo, metodo, confianca)
          SELECT DISTINCT ON (pc.codigo)
            pc.company_id, pc.codigo, pc.descricao, 'psgestao', s.psgc_codigo, 'auto_keyword', s.confianca
          FROM erp_plano_contas pc
          CROSS JOIN LATERAL fn_psgc_sugerir_conta(
            pc.descricao,
            CASE pc.tipo WHEN 'receita' THEN 'receita' WHEN 'custo' THEN 'custo' WHEN 'despesa' THEN 'despesa' ELSE NULL END
          ) s
          WHERE pc.company_id = v_job.company_id AND pc.ativo AND pc.nivel = 3 AND s.confianca >= 75
          ON CONFLICT (company_id, origem_codigo, origem_sistema) DO NOTHING;
        WHEN 'onboarding_inicial' THEN
          PERFORM fn_psgc_enfileirar(v_job.company_id, 'mapear_plano_contas', NULL, NULL, 1, 'onboarding');
          PERFORM fn_psgc_enfileirar(v_job.company_id, 'recalcular_abc', v_job.ano, NULL, 2, 'onboarding');
          FOR i IN 0..11 LOOP
            PERFORM fn_psgc_enfileirar(v_job.company_id, 'recalcular_dre_mes',
              EXTRACT(YEAR FROM (CURRENT_DATE - (i || ' month')::interval))::int,
              EXTRACT(MONTH FROM (CURRENT_DATE - (i || ' month')::interval))::int, 3, 'onboarding');
          END LOOP;
        WHEN 'reprocessar_empresa' THEN
          FOR i IN 0..11 LOOP
            PERFORM fn_psgc_recalcular_dre_mes(v_job.company_id,
              EXTRACT(YEAR FROM (CURRENT_DATE - (i || ' month')::interval))::int,
              EXTRACT(MONTH FROM (CURRENT_DATE - (i || ' month')::interval))::int);
          END LOOP;
          PERFORM fn_psgc_recalcular_abc(v_job.company_id, EXTRACT(YEAR FROM CURRENT_DATE)::int, NULL);
        ELSE
          RAISE EXCEPTION 'Tipo de job desconhecido: %', v_job.tipo;
      END CASE;

      v_fim := clock_timestamp();
      v_duracao_ms := EXTRACT(MILLISECONDS FROM v_fim - v_inicio)::int;
      v_duracao_agregada := v_duracao_agregada + v_duracao_ms;
      UPDATE psgc_job_queue SET status = 'concluido', completed_at = v_fim, duracao_ms = v_duracao_ms WHERE id = v_job.id;
      v_sucessos := v_sucessos + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fim := clock_timestamp();
      v_duracao_ms := EXTRACT(MILLISECONDS FROM v_fim - v_inicio)::int;
      UPDATE psgc_job_queue
         SET status = CASE WHEN tentativas >= max_tentativas THEN 'erro' ELSE 'pendente' END,
             erro_mensagem = SQLERRM, duracao_ms = v_duracao_ms,
             completed_at = CASE WHEN tentativas >= max_tentativas THEN v_fim ELSE NULL END
       WHERE id = v_job.id;
      v_erros := v_erros + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_total, v_sucessos, v_erros, v_duracao_agregada;
END $$;
REVOKE ALL ON FUNCTION public.fn_psgc_processar_fila(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_psgc_processar_fila(integer) TO service_role;

-- ───────── (4) cron 6: lote 50 ─────────
DO $$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE command ~ 'fn_psgc_processar_fila\(\s*\d+\s*\)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, command := 'SELECT fn_psgc_processar_fila(50)');
  END IF;
END $$;

-- ───────── (5) vigia: tipo de job sem andar há mais de 1 h ─────────
CREATE OR REPLACE FUNCTION public.fn_psgc_fila_vigiar()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH p AS (
    SELECT tipo, count(*) pendentes, min(created_at) mais_antigo, count(DISTINCT company_id) empresas
      FROM psgc_job_queue
     WHERE status = 'pendente' AND tentativas < max_tentativas
     GROUP BY tipo),
  parados AS (SELECT * FROM p WHERE mais_antigo < now() - interval '1 hour')
  SELECT jsonb_build_object(
    'ok', NOT EXISTS (SELECT 1 FROM parados),
    'parados', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'pendentes', pendentes, 'empresas', empresas,
                          'esperando_min', round(extract(epoch FROM now() - mais_antigo) / 60)) ORDER BY mais_antigo) FROM parados), '[]'::jsonb),
    'pendentes_total', COALESCE((SELECT sum(pendentes) FROM p), 0))
$$;
REVOKE ALL ON FUNCTION public.fn_psgc_fila_vigiar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_psgc_fila_vigiar() TO service_role;

-- briefing: entra ao lado do menu vazio (patch por âncora, corpo vigente preservado)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_briefing_sessao()'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_psgc_fila_vigiar' THEN
    v_new := replace(v_def, E'  -- 28/09: menu vazio',
      E'  -- 02/10: fila PSGC — tipo de job sem andar há mais de 1 hora (starvation de 28/09)\n'
      || E'  v_result := v_result || jsonb_build_object(''psgc_fila'', public.fn_psgc_fila_vigiar());\n'
      || E'  IF NOT coalesce((v_result->''psgc_fila''->>''ok'')::boolean, true) THEN\n'
      || E'    v_result := jsonb_set(v_result, ''{alertas_pendentes_para_ceo,psgc_fila_parada}'', jsonb_build_object(\n'
      || E'      ''parados'', v_result->''psgc_fila''->''parados'',\n'
      || E'      ''acao'', ''Fila PSGC parada (DRE/fluxo/ABC desatualizados): ver psgc_fila e o cron do psgc-worker''), true);\n'
      || E'  END IF;\n'
      || E'  -- 28/09: menu vazio');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora 28/09 menu vazio nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;
