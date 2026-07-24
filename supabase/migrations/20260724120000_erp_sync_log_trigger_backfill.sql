-- ATAK backfill (R6): heartbeat da carga histórica usa trigger_type='coletor_atak_backfill'
-- para não se confundir com o coletor diário no cão de guarda. Additive (RD-55) — o mesmo CHECK
-- já nos travou antes (RD-57), por isso estende em vez de assumir.
ALTER TABLE public.erp_sync_log DROP CONSTRAINT erp_sync_log_trigger_type_check;
ALTER TABLE public.erp_sync_log ADD CONSTRAINT erp_sync_log_trigger_type_check
  CHECK (trigger_type = ANY (ARRAY['cron'::text,'manual'::text,'webhook'::text,'coletor_atak'::text,'coletor_atak_backfill'::text]));
