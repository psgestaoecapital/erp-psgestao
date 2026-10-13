-- NFE-EMISSAO · Reconsulta automática de NF-e presa em 'processando' (Focus NFe assíncrona).
-- Auditoria (RD-38): as 2 notas da KGF de 25/08 (refs nfe-1787678735336 / nfe-1787678673759)
-- ficaram status='processando' (provider_raw.status='processando_autorizacao'), motivo nulo — o PS
-- emitia mas nunca reconsultava o retorno da SEFAZ. Espelha o padrão já usado para NFSe
-- (fn_nfse_auto_consultar_pendentes, jobid 39) e para DF-e (fn_dfe_baixar_xml_pendentes_dispatch).
--
-- 1) Dispatch fire-and-forget → edge worker nfe-consultar-processando (faz o loop/consulta/update).
-- 2) Cron a cada 15 min. Cobre nota deixada pelo usuário e reprocessa as presas — nenhuma trava.

CREATE OR REPLACE FUNCTION public.fn_nfe_auto_consultar_pendentes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_service_role text;
  v_url_base     text := 'https://horsymhsinqcimflrtjo.supabase.co';
  v_pendentes    int;
  v_request_id   bigint;
BEGIN
  -- Curto-circuita se não há nada preso (evita martelar a edge/Focus).
  SELECT count(*) INTO v_pendentes
    FROM erp_nfe_emitidas
   WHERE provider = 'focusnfe'
     AND provider_reference IS NOT NULL
     AND criado_em >= now() - interval '7 days'
     AND (status = 'processando' OR (status = 'autorizada' AND xml_url IS NULL));

  IF v_pendentes = 0 THEN
    RETURN jsonb_build_object('ok', true, 'pendentes', 0, 'pulado', true);
  END IF;

  SELECT decrypted_secret INTO v_service_role
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';

  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_nfe_auto_consultar_pendentes: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  SELECT net.http_post(
    url     := v_url_base || '/functions/v1/nfe-consultar-processando',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_role
    ),
    body                  := jsonb_build_object('origem', 'cron'),
    timeout_milliseconds  := 120000
  ) INTO v_request_id;

  RETURN jsonb_build_object('ok', true, 'pendentes', v_pendentes, 'request_id', v_request_id, 'ts', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_nfe_auto_consultar_pendentes() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nfe_auto_consultar_pendentes() TO service_role;

-- Cron a cada 15 min (idempotente). NF-e autoriza em segundos/minutos; 15 min é folgado e cobre gaps.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nfe-consultar-processando') THEN
    PERFORM cron.unschedule('nfe-consultar-processando');
  END IF;
END $$;

SELECT cron.schedule(
  'nfe-consultar-processando',
  '*/15 * * * *',
  $cron$ SELECT public.fn_nfe_auto_consultar_pendentes(); $cron$
);
