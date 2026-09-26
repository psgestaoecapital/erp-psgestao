-- GE-F7 · arquivamento XML/PDF (11 anos, SINIEF): worker existia desde 02/06 e NUNCA foi chamado (contexto 278db003).
-- Dispatch nos moldes de fn_dfe_baixar_xml_pendentes_dispatch (jobid 41) + cron a cada 15 min.
-- (timestamp 150000: 130000 e a invites_e_audit_log_hardening do PR 1810 e 140000 e a revenda_veiculo_desativado do PR 1811 - RD-52, sem colisao no ledger)

CREATE OR REPLACE FUNCTION public.fn_fiscal_storage_dispatch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE v_service_role text; v_url_base text := 'https://horsymhsinqcimflrtjo.supabase.co'; v_pendentes int; v_request_id bigint;
BEGIN
  -- curto-circuito: nada pendente (ou so falhas repetidas) => nao martela a edge
  SELECT count(*) INTO v_pendentes FROM erp_fiscal_storage_queue WHERE NOT processado AND tentativas < 5;
  IF v_pendentes = 0 THEN RETURN jsonb_build_object('ok', true, 'pendentes', 0, 'pulado', true); END IF;

  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_fiscal_storage_dispatch: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  SELECT net.http_post(
    url     := v_url_base || '/functions/v1/fiscal-storage-worker?limit=50',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body    := jsonb_build_object('origem', 'cron'),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN jsonb_build_object('ok', true, 'pendentes', v_pendentes, 'request_id', v_request_id, 'ts', now());
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_fiscal_storage_dispatch() FROM PUBLIC, anon, authenticated;

-- cron: a cada 15 min (idempotente: remove se ja existir com esse nome)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fiscal-storage-worker') THEN
    PERFORM cron.unschedule('fiscal-storage-worker');
  END IF;
  PERFORM cron.schedule('fiscal-storage-worker', '*/15 * * * *', $c$ SELECT public.fn_fiscal_storage_dispatch(); $c$);
END $$;

-- briefing: fila de arquivamento como sinal (RD-51: job sem resultado = cinza, nunca verde)
CREATE OR REPLACE FUNCTION public.fn_fiscal_storage_briefing() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'pendentes', s.pendentes, 'processados', s.processados, 'falhas_repetidas', s.falhas_repetidas,
    'ultimo_processado_em', s.ultimo_processado_em, 'mais_antigo_pendente', s.mais_antigo_pendente,
    'sinal', CASE WHEN s.ultimo_processado_em IS NULL THEN 'CINZA: nunca processou'
                  WHEN s.ultimo_processado_em < now() - interval '2 hours' AND s.pendentes > 0 THEN 'VERMELHO: pendentes e worker parado > 2h'
                  WHEN s.falhas_repetidas > 0 THEN 'AMARELO: documentos com 5+ falhas (URL da Focus expirada?)'
                  ELSE 'VERDE' END)
  FROM v_fiscal_storage_status s
$$;
REVOKE EXECUTE ON FUNCTION public.fn_fiscal_storage_briefing() FROM PUBLIC, anon;

DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname='fn_briefing_sessao';
  IF v_def ~ 'fiscal_storage' THEN RETURN; END IF;
  v_new := replace(v_def, E'  RETURN v_result;\nEND;',
    E'  v_result := v_result || jsonb_build_object(''arquivamento_fiscal'', fn_fiscal_storage_briefing());\n  RETURN v_result;\nEND;');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_briefing_sessao: ancora nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;
