-- ANEXO-2 · agendamento da limpeza dos temporários (autorizado pelo CEO 28/08).
-- fn_crm_anexo_limpar_temporarios(24) roda diariamente às 03h (UTC), apaga só objetos em '/tmp/' com
-- mais de 24h, e loga quantos apagou. Nunca toca em anexo confirmado (a função já garante isso).
-- Reprodutível: ambiente novo/restore recria a tabela de log e reagenda o job (idempotente por nome).

CREATE TABLE IF NOT EXISTS public.erp_crm_anexo_limpeza_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rodou_em  timestamptz NOT NULL DEFAULT now(),
  apagados  int,
  resultado jsonb
);

-- só agenda se o pg_cron estiver disponível (não quebra ambientes sem a extensão)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('crm_anexo_limpar_tmp', '0 3 * * *',
      $cmd$INSERT INTO public.erp_crm_anexo_limpeza_log (apagados, resultado)
           SELECT (r->>'apagados')::int, r FROM (SELECT public.fn_crm_anexo_limpar_temporarios(24) AS r) x$cmd$);
  END IF;
END $cron$;
