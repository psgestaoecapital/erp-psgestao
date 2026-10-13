-- PARTE 1.3 · CRON do alerta de silêncio do coletor ATAK.
-- Autorizado pelo CEO no SPEC ("O CEO autoriza o cron.schedule — Code Web aplica").
-- Custo zero (RD-42): roda 2x/dia em dia útil e só INSERE alerta se houver silêncio real (>12h);
-- com dado fresco retorna 'ok' e não faz nada.
--
-- pg_cron roda em UTC no Supabase. Horário comercial BRT (UTC-3):
--   11h BRT = 14:00 UTC · 18h BRT = 21:00 UTC · dias úteis = 1-5 (seg-sex).
-- A própria fn_atak_alerta_silencio revalida "dia útil" em America/Sao_Paulo (cinto e suspensório).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'atak-alerta-silencio') THEN
    PERFORM cron.unschedule('atak-alerta-silencio');
  END IF;
END $$;

SELECT cron.schedule(
  'atak-alerta-silencio',
  '0 14,21 * * 1-5',
  $$SELECT public.fn_atak_alerta_silencio();$$
);
