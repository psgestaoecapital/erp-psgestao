-- CRON-PONTO · pg_cron horário para o sync do ponto (IO Point), atendendo o teste 4 do SPEC
-- (`SELECT count(*) FROM cron.job WHERE jobname ILIKE '%ponto%'` = 1, ativo, '0 * * * *').
--
-- Auditoria (RD-38/RD-51): o Vault NÃO tem CRON_SECRET/PING_SICOOB_SECRET (listei os 31 secrets —
-- só há a service key `SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER`, além de tokens de API/banco/IO Point).
-- Por isso o dispatch autentica na rota Vercel com a SERVICE ROLE key (a rota passou a aceitar esse
-- Bearer, máquina-a-máquina). Mesmo esquema dos outros dispatch (fn_dfe_baixar_xml_pendentes_dispatch),
-- só que apontando para a rota Vercel (o sync do ponto vive lá, não numa edge).
--
-- A rota /api/cron/ponto-diario já: cobre todas as empresas ind_ponto_provider_config.ativo=true,
-- sincroniza o MÊS CORRENTE inteiro, grava por UPSERT (onConflict company_id,cpf,data) e isola erro
-- por empresa. O Vercel Cron desta rota fica como rede de segurança DIÁRIA (auth independente).

CREATE OR REPLACE FUNCTION public.fn_ponto_sync_dispatch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_service_role text;
  v_url text := 'https://erp-psgestao.vercel.app/api/cron/ponto-diario';
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_service_role
    FROM vault.decrypted_secrets
   WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';

  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_ponto_sync_dispatch: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;

  -- Fire-and-forget: a rota Vercel roda o sync (mês corrente, todas as empresas, UPSERT) por conta.
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_role
    ),
    body                  := jsonb_build_object('origem', 'pg_cron'),
    timeout_milliseconds  := 300000
  ) INTO v_request_id;

  RETURN jsonb_build_object('ok', true, 'request_id', v_request_id, 'ts', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ponto_sync_dispatch() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ponto_sync_dispatch() TO service_role;

-- Cron a cada 1 hora (idempotente).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ponto-sync-horario') THEN
    PERFORM cron.unschedule('ponto-sync-horario');
  END IF;
END $$;

SELECT cron.schedule(
  'ponto-sync-horario',
  '0 * * * *',
  $cron$ SELECT public.fn_ponto_sync_dispatch(); $cron$
);
