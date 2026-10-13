-- =============================================================
-- FEAT-NFSE-AUTOMACAO-v1 · Cron auto-consultar NFS-e pendentes
-- =============================================================
-- Job a cada 15 min que consulta status na Focus pra notas
-- 'processando' criadas nos ultimos 7 dias (cap pra nao martelar
-- notas velhas). Chama edge gov-nfse-consultar via pg_net com
-- Bearer service_role do Vault.
--
-- Edge gov-nfse-consultar atualiza o registro · fire-and-forget
-- aqui (response chega pelo request_id em net._http_response).
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_nfse_auto_consultar_pendentes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_service_role text;
  v_url_base text := 'https://horsymhsinqcimflrtjo.supabase.co';
  v_rec record;
  v_request_id bigint;
  v_qtd int := 0;
  v_request_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  -- Le service_role do Vault (mesmo padrao do Pluggy worker)
  SELECT decrypted_secret INTO v_service_role
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';

  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_nfse_auto_consultar_pendentes: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  FOR v_rec IN
    SELECT id
    FROM erp_nfse_emitidas
    WHERE status = 'processando'
      AND criado_em >= now() - interval '7 days'
      AND provider = 'focusnfe'
    ORDER BY criado_em
    LIMIT 50
  LOOP
    SELECT net.http_post(
      url := v_url_base || '/functions/v1/gov-nfse-consultar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role
      ),
      body := jsonb_build_object('record_id', v_rec.id),
      timeout_milliseconds := 15000
    ) INTO v_request_id;

    v_request_ids := array_append(v_request_ids, v_request_id);
    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'qtd_disparada', v_qtd,
    'request_ids', to_jsonb(v_request_ids),
    'ts', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_nfse_auto_consultar_pendentes IS
  'FEAT-NFSE-AUTOMACAO-v1 · dispara consulta Focus em notas processando ate 7 dias (cap 50).';

REVOKE ALL ON FUNCTION public.fn_nfse_auto_consultar_pendentes() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_nfse_auto_consultar_pendentes() TO service_role;

-- Cron a cada 15 min (idempotente: unschedule antes se ja existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nfse-auto-consultar-pendentes') THEN
    PERFORM cron.unschedule('nfse-auto-consultar-pendentes');
  END IF;
END $$;

SELECT cron.schedule(
  'nfse-auto-consultar-pendentes',
  '*/15 * * * *',
  $cron$ SELECT public.fn_nfse_auto_consultar_pendentes(); $cron$
);
