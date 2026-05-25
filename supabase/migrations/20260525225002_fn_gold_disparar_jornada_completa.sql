-- AUDITORIA GOLD FASE 2 · RPC dispara jornada completa (3 camadas em paralelo)
-- Aplicado via MCP apply_migration 25/05/2026 ~22:50 BRT

CREATE OR REPLACE FUNCTION public.fn_gold_disparar_jornada_completa(
  p_rota TEXT,
  p_pr_numero INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_t0 TIMESTAMPTZ := NOW();
  v_screen_id TEXT;
  v_camada1 JSONB;
  v_camada2 JSONB;
  v_camada3 JSONB;
  v_url_jornada TEXT := 'https://horsymhsinqcimflrtjo.supabase.co/functions/v1/auditoria-gold-jornada';
  v_request_id BIGINT;
BEGIN
  SELECT id INTO v_screen_id FROM system_screens WHERE rota = p_rota LIMIT 1;

  IF v_screen_id IS NULL THEN
    RETURN jsonb_build_object('erro', 'rota nao cadastrada em system_screens', 'rota', p_rota);
  END IF;

  v_camada1 := fn_auditor_disparar(p_rota);

  SELECT net.http_post(
    url := v_url_jornada,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-watcher-secret', 'ps-watcher-2026-9k2mxqp4nv8wzr7y6h3t'
    ),
    body := jsonb_build_object('rota', p_rota, 'screen_id', v_screen_id),
    timeout_milliseconds := 180000
  ) INTO v_request_id;

  v_camada2 := jsonb_build_object('request_id', v_request_id, 'disparado_em', NOW());

  v_camada3 := fn_disparar_insight_auditor_prioridade('critica', 1);

  RETURN jsonb_build_object(
    'rota', p_rota,
    'screen_id', v_screen_id,
    'pr_numero', p_pr_numero,
    't0', v_t0,
    'camada1', v_camada1,
    'camada2', v_camada2,
    'camada3', v_camada3,
    'instrucao', 'Aguarde 120s e chame fn_gold_consolidar_veredito_triplo(rota, t0)'
  );
END;
$$;
