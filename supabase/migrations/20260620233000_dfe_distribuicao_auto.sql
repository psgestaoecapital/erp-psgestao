-- DF-e Onda 2.2 · captura automatica (cron distribuicao + auto-ciencia)
-- Adiciona 2 colunas em erp_nfe_distribuicao_controle:
--   auto_ciencia    : se true, edge ja manifesta ciencia em toda nota
--                     nova captura (default true · neutra).
--   ultimo_ciclo_em : timestamp do ultimo ciclo completo de captura,
--                     usado pelo worker pra respeitar ~1h entre ciclos
--                     (limite SEFAZ).

ALTER TABLE public.erp_nfe_distribuicao_controle
  ADD COLUMN IF NOT EXISTS auto_ciencia    boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ultimo_ciclo_em timestamptz;

COMMENT ON COLUMN public.erp_nfe_distribuicao_controle.auto_ciencia IS
  'Onda 2.2 · Quando true, a edge nfe-distribuicao manifesta ciencia '
  'automaticamente em todas as notas novas (210210 · neutra).';

COMMENT ON COLUMN public.erp_nfe_distribuicao_controle.ultimo_ciclo_em IS
  'Onda 2.2 · Timestamp do ultimo ciclo completo de captura. Usado '
  'pelo worker dfe-distribuicao-auto pra filtrar empresas elegiveis '
  '(>= 55min desde o ultimo ciclo · respeita ~1h SEFAZ).';

-- ---------------------------------------------------------------
-- Dispatcher do cron · dispara a edge nfe-distribuicao-auto.
-- Padrao identico ao fn_dfe_baixar_xml_pendentes_dispatch (Onda 2.1).
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_dfe_distribuicao_auto_dispatch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_service_role text;
  v_url_base     text := 'https://horsymhsinqcimflrtjo.supabase.co';
  v_elegiveis    int;
  v_request_id   bigint;
BEGIN
  -- Curto-circuita se nao ha empresa elegivel (>= 55min do ultimo ciclo)
  SELECT count(*) INTO v_elegiveis
    FROM erp_nfe_distribuicao_controle
   WHERE habilitado = true
     AND (ultimo_ciclo_em IS NULL OR ultimo_ciclo_em < now() - interval '55 minutes');

  IF v_elegiveis = 0 THEN
    RETURN jsonb_build_object('ok', true, 'elegiveis', 0, 'pulado', true);
  END IF;

  SELECT decrypted_secret INTO v_service_role
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';

  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_dfe_distribuicao_auto_dispatch: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  SELECT net.http_post(
    url     := v_url_base || '/functions/v1/nfe-distribuicao-auto',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_role
    ),
    body                  := jsonb_build_object('origem', 'cron'),
    timeout_milliseconds  := 300000
  ) INTO v_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'elegiveis', v_elegiveis,
    'request_id', v_request_id,
    'ts', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_dfe_distribuicao_auto_dispatch IS
  'Onda 2.2 · Dispara edge nfe-distribuicao-auto quando ha empresas '
  'elegiveis (>= 55min do ultimo ciclo). Cron a cada 1h.';

REVOKE ALL ON FUNCTION public.fn_dfe_distribuicao_auto_dispatch() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dfe_distribuicao_auto_dispatch() TO service_role;

-- ---------------------------------------------------------------
-- Cron de hora em hora (idempotente). O worker filtra o ~1h.
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dfe-distribuicao-auto') THEN
    PERFORM cron.unschedule('dfe-distribuicao-auto');
  END IF;
END $$;

SELECT cron.schedule(
  'dfe-distribuicao-auto',
  '0 * * * *',
  $cron$ SELECT public.fn_dfe_distribuicao_auto_dispatch(); $cron$
);
