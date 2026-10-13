-- RD-41 · Pátio — entregue_em como fonte de verdade de "quando foi entregue".
-- Aditivo (RD): coluna nova ao lado; trigger popula ao entrar em 'entregue' (pega
-- todos os caminhos de set-status). Backfill estimado das já entregues (= updated_at).
-- Operacional puro (não toca GE).

ALTER TABLE public.erp_os ADD COLUMN IF NOT EXISTS entregue_em timestamptz;

CREATE OR REPLACE FUNCTION public.fn_os_marcar_entregue_em()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  -- carimba entregue_em na primeira vez que a OS entra em 'entregue'
  IF NEW.status = 'entregue'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'entregue')
     AND NEW.entregue_em IS NULL THEN
    NEW.entregue_em := now();
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_os_entregue_em ON public.erp_os;
CREATE TRIGGER trg_os_entregue_em
  BEFORE INSERT OR UPDATE ON public.erp_os
  FOR EACH ROW EXECUTE FUNCTION public.fn_os_marcar_entregue_em();

-- Backfill estimado das 20 já entregues (aproximação por updated_at).
UPDATE public.erp_os SET entregue_em = updated_at
 WHERE status = 'entregue' AND entregue_em IS NULL;
