-- DF-e Onda 2.1 · Fluxo assincrono de XML
-- ---------------------------------------------------------------
-- Causa raiz: o procNFe completo so e liberado pela SEFAZ apos a
-- manifestacao de ciencia, e o Focus sincroniza esse pool a cada
-- ~2h. Logo, manifestar -> baixar XML em 1 request nao funciona
-- pra nota nova. Esta migration adiciona colunas de controle e o
-- worker dispatcher do cron que vara o pool de notas pendentes.
-- ---------------------------------------------------------------

-- 1) Colunas de controle em erp_nfe_recebidas
ALTER TABLE erp_nfe_recebidas
  ADD COLUMN IF NOT EXISTS manifestado_em        timestamptz,
  ADD COLUMN IF NOT EXISTS xml_tentativas        int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultima_tentativa_xml  timestamptz,
  ADD COLUMN IF NOT EXISTS lancar_ao_completar   boolean     NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_nfe_recebidas.manifestado_em IS
  'Onda 2.1 · Quando a ciencia foi enviada a SEFAZ via Focus.';
COMMENT ON COLUMN erp_nfe_recebidas.xml_tentativas IS
  'Onda 2.1 · Quantas vezes o worker tentou baixar o procNFe.';
COMMENT ON COLUMN erp_nfe_recebidas.ultima_tentativa_xml IS
  'Onda 2.1 · Timestamp da ultima tentativa de download do XML.';
COMMENT ON COLUMN erp_nfe_recebidas.lancar_ao_completar IS
  'Onda 2.1 · Quando true, ao baixar o XML o worker chama '
  'fn_nfe_recebida_gerar_pagar automaticamente.';

CREATE INDEX IF NOT EXISTS idx_erp_nfe_recebidas_aguardando_xml
  ON erp_nfe_recebidas (ultima_tentativa_xml NULLS FIRST)
  WHERE status = 'aguardando_xml';

-- ---------------------------------------------------------------
-- 2) Dispatcher do cron · dispara a edge nfe-baixar-xml-pendentes.
-- Padrao identico ao fn_nfse_auto_consultar_pendentes (NFSe).
-- Le SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER do Vault e dispara um
-- net.http_post fire-and-forget pra edge worker, que faz o loop
-- interno respeitando o throttle de 2s e o limite SEFAZ.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_dfe_baixar_xml_pendentes_dispatch()
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
  -- Curto-circuita se nao ha pendentes (evita martelar a edge)
  SELECT count(*) INTO v_pendentes
    FROM erp_nfe_recebidas
   WHERE status = 'aguardando_xml';

  IF v_pendentes = 0 THEN
    RETURN jsonb_build_object('ok', true, 'pendentes', 0, 'pulado', true);
  END IF;

  SELECT decrypted_secret INTO v_service_role
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';

  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_dfe_baixar_xml_pendentes_dispatch: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  SELECT net.http_post(
    url     := v_url_base || '/functions/v1/nfe-baixar-xml-pendentes',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_role
    ),
    body                  := jsonb_build_object('origem', 'cron'),
    timeout_milliseconds  := 120000
  ) INTO v_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'pendentes', v_pendentes,
    'request_id', v_request_id,
    'ts', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_dfe_baixar_xml_pendentes_dispatch IS
  'Onda 2.1 · Dispara edge nfe-baixar-xml-pendentes quando ha notas '
  'em aguardando_xml. Cron a cada 30 min.';

REVOKE ALL ON FUNCTION public.fn_dfe_baixar_xml_pendentes_dispatch() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dfe_baixar_xml_pendentes_dispatch() TO service_role;

-- ---------------------------------------------------------------
-- 3) Cron a cada 30 min (idempotente)
-- 30 min cobre o lag de ~2h do Focus sem martelar.
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dfe-baixar-xml-pendentes') THEN
    PERFORM cron.unschedule('dfe-baixar-xml-pendentes');
  END IF;
END $$;

SELECT cron.schedule(
  'dfe-baixar-xml-pendentes',
  '*/30 * * * *',
  $cron$ SELECT public.fn_dfe_baixar_xml_pendentes_dispatch(); $cron$
);
