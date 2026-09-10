-- ============================================================
-- #39 (Julia) · Título QUITADO fica preso em 'parcial' — status não recomputa ao editar o valor
--
-- Causa raiz (RD-38, auditado no dado): a Julia baixou um salário (R$2.427,23) em pagamento parcial e
-- depois o VALOR do título foi editado para bater com o pago. fn_pagar_editar (e as demais edições)
-- trocam o `valor` mas NÃO recomputam o `status`. Resultado: valor_pago = valor (quitado), mas status
-- continua 'parcial' — e a conciliação recusa (título "já parcial"). As RPCs de baixa
-- (fn_pagar_registrar_pagamento / fn_pagar_baixar_pagamento / fn_recompute_baixa_titulo) já calculam o
-- status certo; o furo é só nos caminhos de EDIÇÃO de valor.
--
-- Correção (robusta, cobre TODOS os caminhos de edição — pagar e receber — de uma vez, vivendo no banco):
--   TRIGGER BEFORE UPDATE que, quando `valor` ou `valor_pago` muda e o título tem pagamento (>0),
--   mantém o status coerente: coberto (valor_pago >= valor − 0,01) => 'pago'; senão => 'parcial'.
--   - Só age em status de ciclo de pagamento ('aberto','vencido','parcial','pago') — nunca em 'cancelado'.
--   - Só quando valor_pago > 0 — não mexe no fluxo aberto/vencido (valor_pago = 0).
--   - Re-deriva o MESMO valor que as RPCs de baixa já gravam, então não conflita com elas.
--
-- Backfill: cura os títulos hoje presos (quitados mas 'parcial') — 2 no total (1 pagar da Julia, 1 receber).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_titulo_normalizar_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.valor IS DISTINCT FROM OLD.valor
      OR COALESCE(NEW.valor_pago,0) IS DISTINCT FROM COALESCE(OLD.valor_pago,0))
     AND NEW.status IN ('aberto','vencido','parcial','pago')
     AND COALESCE(NEW.valor_pago,0) > 0 THEN
    NEW.status := CASE WHEN COALESCE(NEW.valor_pago,0) >= NEW.valor - 0.01 THEN 'pago' ELSE 'parcial' END;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pagar_normalizar_status ON public.erp_pagar;
CREATE TRIGGER trg_pagar_normalizar_status
  BEFORE UPDATE ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_titulo_normalizar_status();

DROP TRIGGER IF EXISTS trg_receber_normalizar_status ON public.erp_receber;
CREATE TRIGGER trg_receber_normalizar_status
  BEFORE UPDATE ON public.erp_receber
  FOR EACH ROW EXECUTE FUNCTION public.fn_titulo_normalizar_status();

-- Backfill: títulos quitados presos em 'parcial' (o da Julia + qualquer outro no mesmo estado).
UPDATE public.erp_pagar SET status = 'pago', updated_at = now()
 WHERE deleted_at IS NULL AND status = 'parcial'
   AND COALESCE(valor_pago,0) > 0 AND COALESCE(valor_pago,0) >= valor - 0.01;

UPDATE public.erp_receber SET status = 'pago', updated_at = now()
 WHERE deleted_at IS NULL AND status = 'parcial'
   AND COALESCE(valor_pago,0) > 0 AND COALESCE(valor_pago,0) >= valor - 0.01;
