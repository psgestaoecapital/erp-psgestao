-- Wealth · conserta o cron do Brapi (valorização diária). Origem: doc Wealth 14/08 (pendência #3).
-- DIAGNÓSTICO (RD-26, cron.job_run_details jobid 19): TODA execução diária falha com
--   "ERROR: invalid transaction termination / ... sp_wealth_brapi_atualizar ... line 14 at COMMIT".
-- Causa: o pg_cron roda o CALL dentro da própria transação; o COMMIT dentro da procedure é ilegal
-- nesse contexto → o job aborta antes de despachar nada (por isso 0 jobs origem='cron'; o manual_api,
-- que roda fora dessa transação, funcionava). Não é timeout nem token (token existe; 3 tickers alvo).
--
-- CORREÇÃO (reversível): não depender de COMMIT-em-procedure. Cron passa a 2 passos com SELECT puro —
--   1) dispatch: enfileira os net.http_get (o pg_net envia quando a transação do cron commita no fim);
--   2) consume: lê net._http_response e grava cotações/posições (idempotente; roda em passes).
-- A procedure sp_wealth_brapi_atualizar e as funções dispatch/consume ficam intactas (caminho manual
-- segue igual). Nenhuma tabela/coluna alterada.

-- 1) Wrapper de consumo dos jobs recentes (sem COMMIT — seguro sob pg_cron).
CREATE OR REPLACE FUNCTION public.fn_wealth_brapi_consume_recentes(p_janela interval DEFAULT interval '2 hours')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  v_job uuid;
  v_n   int := 0;
BEGIN
  FOR v_job IN
    SELECT DISTINCT r.job_id
    FROM wealth_cotacao_jobs_requests r
    JOIN wealth_cotacao_jobs j ON j.id = r.job_id
    WHERE r.consumido = false
      AND j.executado_em > now() - p_janela
  LOOP
    PERFORM public.fn_wealth_brapi_consume(v_job);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'jobs_processados', v_n);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_wealth_brapi_consume_recentes(interval) TO authenticated;

-- 2) Reagenda o cron: remove o job quebrado e cria dispatch + consume (SELECT puro, sem COMMIT).
--    Envolto em DO para ser idempotente e não deixar SELECT solto de topo.
DO $cron$
DECLARE v_jobid bigint;
BEGIN
  -- remove o job antigo que chamava a procedure com COMMIT (falhava todo dia)
  FOR v_jobid IN SELECT jobid FROM cron.job WHERE jobname = 'wealth-cotacao-diaria' LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;

  -- passo 1: dispara (09:00, dias úteis). Ao commitar a transação do cron, o pg_net envia os http_get.
  PERFORM cron.schedule(
    'wealth-brapi-dispatch', '0 9 * * 1-5',
    'SELECT public.fn_wealth_brapi_dispatch(NULL, ''cron'', NULL);'
  );

  -- passo 2: consome as respostas em alguns passes (09:03/07/12) — idempotente; só finaliza quando todas chegam.
  PERFORM cron.schedule(
    'wealth-brapi-consume', '3,7,12 9 * * 1-5',
    'SELECT public.fn_wealth_brapi_consume_recentes();'
  );
END
$cron$;
