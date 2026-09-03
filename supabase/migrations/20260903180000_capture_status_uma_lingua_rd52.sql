-- capture_status: UMA língua só (português), com a verdade preservada (RD-52).
--
-- Achado do CEO no dado: duas origens gravavam vocabulários diferentes na MESMA coluna
-- system_screens_history.capture_status:
--   • playwright (Next)                 → PT: sucesso (COM foto) / erro / rota_nao_alcancada / nao_carregou
--   • edge screen-watcher (deno_fetch_v2, sonda HTTP que lê HTML e NÃO fotografa) → EN: success / 404 / ...
-- O CHECK aceitava os dois. Pior: dois consumidores usam `capture_status != 'success'` como definição
-- de "problema" — então TODA foto de verdade do playwright (status 'sucesso') era contada como FALHA.
-- Duas línguas se encontrando exatamente onde dói (contador de erro e lista de alertas).
--
-- Regra de veracidade (RD-51/RD-58): 'sucesso' = FOTOGRAFOU. A sonda HTML ALCANÇOU mas NÃO fotografa —
-- isso é 'html_ok', nunca 'sucesso'. Erros unificados em PT. O valor antigo fica guardado numa coluna
-- paralela (reconstituível — mesmo princípio da tradução gente/SST): um número de ontem pode ser refeito.

-- (1) Coluna paralela: preserva o valor PRÉ-tradução de toda linha (auditoria / reconstituição).
ALTER TABLE public.system_screens_history ADD COLUMN IF NOT EXISTS capture_status_original text;
UPDATE public.system_screens_history
   SET capture_status_original = capture_status
 WHERE capture_status_original IS NULL;

-- (2) CHECK transitório: superconjunto (PT honesto + EN legado) para a tradução não bater no constraint.
ALTER TABLE public.system_screens_history DROP CONSTRAINT IF EXISTS system_screens_history_capture_status_check;
ALTER TABLE public.system_screens_history ADD CONSTRAINT system_screens_history_capture_status_check
  CHECK (capture_status = ANY (ARRAY[
    'sucesso','html_ok','erro','timeout','nao_encontrada','auth_falhou','rota_nao_alcancada','nao_carregou',
    'success','error','auth_failed','404'  -- EN legado: aceito só entre (2) e (5), removido no aperto final
  ]::text[]));

-- (3) Traduz o histórico para a língua única e honesta (só toca EN; PT já existente fica intacto).
UPDATE public.system_screens_history SET capture_status = 'html_ok'        WHERE capture_status = 'success';
UPDATE public.system_screens_history SET capture_status = 'nao_encontrada' WHERE capture_status = '404';
UPDATE public.system_screens_history SET capture_status = 'erro'           WHERE capture_status = 'error';
UPDATE public.system_screens_history SET capture_status = 'auth_falhou'    WHERE capture_status = 'auth_failed';
-- 'timeout' é o mesmo termo em PT/EN: nada a traduzir.

-- (4) Consumidores: "problema" = tudo que NÃO é OK. OK = fotografou ('sucesso') OU alcançou-HTML ('html_ok').
--     Antes o sentinel `!= 'success'` contava 'sucesso' (foto boa) como falha. Corrige nos dois lugares.
CREATE OR REPLACE FUNCTION public.fn_admin_screen_watcher_dashboard()
 RETURNS TABLE(screen_id text, rota text, area text, titulo text, screenshot_url text, screenshot_atualizado_em timestamp with time zone, estado_real text, prioridade_monitoramento text, ultima_captura timestamp with time zone, ultima_captura_status text, total_capturas bigint, capturas_falha_24h bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.rota, s.area, s.titulo,
    s.screenshot_url, s.screenshot_atualizado_em,
    s.estado_real, s.prioridade_monitoramento,
    (SELECT MAX(h.captured_at) FROM system_screens_history h WHERE h.screen_id = s.id),
    (SELECT h2.capture_status FROM system_screens_history h2
     WHERE h2.screen_id = s.id ORDER BY h2.captured_at DESC LIMIT 1),
    (SELECT COUNT(*) FROM system_screens_history h3 WHERE h3.screen_id = s.id),
    (SELECT COUNT(*) FROM system_screens_history h4
     WHERE h4.screen_id = s.id
       AND h4.capture_status NOT IN ('sucesso','html_ok')
       AND h4.captured_at > NOW() - INTERVAL '24 hours')
  FROM system_screens s
  ORDER BY
    CASE s.prioridade_monitoramento
      WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
    s.area, s.rota;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_consolidar_alertas_auditores()
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_truth_alerts jsonb;
  v_visual_alerts jsonb;
  v_screen_failures jsonb;
  v_resumo jsonb;
  v_total_criticos int := 0;
  v_total_warns int := 0;
BEGIN
  -- 1. Truth Auditor (DRE) - usar colunas reais
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'criticos', COUNT(*) FILTER (WHERE severity = 'critical'),
    'warns', COUNT(*) FILTER (WHERE severity = 'warn'),
    'ja_apresentados', COUNT(*) FILTER (WHERE apresentado_engenheiro_chefe = true),
    'novos_para_engenheiro', COUNT(*) FILTER (WHERE apresentado_engenheiro_chefe = false OR apresentado_engenheiro_chefe IS NULL),
    'ultimos', COALESCE((
      SELECT jsonb_agg(j ORDER BY (j->>'detectado_em')::timestamptz DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', id,
          'severity', severity,
          'tipo', tipo_divergencia,
          'area', area,
          'mensagem', LEFT(mensagem, 200),
          'delta_pct', delta_percentual,
          'detectado_em', detected_at,
          'ja_apresentado', apresentado_engenheiro_chefe
        ) AS j
        FROM erp_truth_alerts
        WHERE status = 'novo'
        ORDER BY detected_at DESC
        LIMIT 5
      ) sub
    ), '[]'::jsonb)
  )
  INTO v_truth_alerts
  FROM erp_truth_alerts
  WHERE status = 'novo';

  -- 2. Visual Truth Auditor
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'criticos', COUNT(*) FILTER (WHERE severity = 'critical'),
    'warns', COUNT(*) FILTER (WHERE severity = 'warn'),
    'ultimos', COALESCE((
      SELECT jsonb_agg(j ORDER BY (j->>'detectado_em')::timestamptz DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', id,
          'severity', severity,
          'rota', rota,
          'expected', expected_value,
          'found', found_value,
          'delta_pct', delta_pct,
          'detectado_em', detected_at
        ) AS j
        FROM visual_truth_alerts
        WHERE status = 'novo'
        ORDER BY detected_at DESC
        LIMIT 5
      ) sub
    ), '[]'::jsonb)
  )
  INTO v_visual_alerts
  FROM visual_truth_alerts
  WHERE status = 'novo';

  -- 3. Screen Watcher (capturas com FALHA 24h). OK = 'sucesso' (foto) OU 'html_ok' (alcançou HTML).
  SELECT jsonb_build_object(
    'total_falhas_24h', COUNT(*),
    'rotas_problematicas', COALESCE((
      SELECT jsonb_agg(DISTINCT j)
      FROM (
        SELECT jsonb_build_object(
          'rota', rota,
          'status', capture_status,
          'errors', LEFT(errors_snapshot, 100),
          'captured_at', captured_at
        ) AS j
        FROM system_screens_history
        WHERE capture_status NOT IN ('sucesso','html_ok')
          AND captured_at > NOW() - INTERVAL '24 hours'
        ORDER BY captured_at DESC
        LIMIT 10
      ) sub
    ), '[]'::jsonb)
  )
  INTO v_screen_failures
  FROM system_screens_history
  WHERE capture_status NOT IN ('sucesso','html_ok')
    AND captured_at > NOW() - INTERVAL '24 hours';

  -- Totais agregados
  v_total_criticos :=
    COALESCE((v_truth_alerts->>'criticos')::int, 0) +
    COALESCE((v_visual_alerts->>'criticos')::int, 0);

  v_total_warns :=
    COALESCE((v_truth_alerts->>'warns')::int, 0) +
    COALESCE((v_visual_alerts->>'warns')::int, 0);

  v_resumo := jsonb_build_object(
    'consultado_em', NOW(),
    'total_criticos', v_total_criticos,
    'total_warns', v_total_warns,
    'truth_auditor_dre', v_truth_alerts,
    'visual_truth_auditor', v_visual_alerts,
    'screen_watcher', v_screen_failures,
    'mensagem_executiva',
      CASE
        WHEN v_total_criticos > 0 THEN
          'ATENCAO: ' || v_total_criticos || ' alertas CRITICOS abertos. Investigar imediatamente.'
        WHEN v_total_warns > 0 THEN
          v_total_warns || ' alertas (warns) abertos. Sem criticos.'
        WHEN COALESCE((v_screen_failures->>'total_falhas_24h')::int, 0) > 0 THEN
          'Sistema integro mas com ' || (v_screen_failures->>'total_falhas_24h') || ' falhas de captura em 24h.'
        ELSE
          'Sistema integro. 0 alertas dos auditores.'
      END
  );

  RETURN v_resumo;
END $function$;

-- (5) Aperta o CHECK: só PT, não aceita mais os dois vocabulários (exigência do CEO). Seguro agora:
--     o histórico foi traduzido em (3) e a edge passa a gravar PT (deploy coordenado desta migration).
ALTER TABLE public.system_screens_history DROP CONSTRAINT IF EXISTS system_screens_history_capture_status_check;
ALTER TABLE public.system_screens_history ADD CONSTRAINT system_screens_history_capture_status_check
  CHECK (capture_status = ANY (ARRAY[
    'sucesso','html_ok','erro','timeout','nao_encontrada','auth_falhou','rota_nao_alcancada','nao_carregou'
  ]::text[]));
