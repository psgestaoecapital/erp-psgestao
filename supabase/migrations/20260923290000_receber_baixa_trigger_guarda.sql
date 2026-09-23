-- Bloco Financeiro (Jordana · #106/#38) — PR2 de 3. Só banco.
-- Fecha "nunca valor_pago direto" com UM trigger-guarda, cobrindo os 5 subsistemas que hoje gravam
-- valor_pago direto (tela fn_receber_baixar_pagamento; conciliação fn_recompute_baixa_titulo; lote
-- batch_baixa_titulos; boleto fn_boleto_liquidar; ajuste/estorno) — e futuros — de forma uniforme.
--
-- Mecanismo (decisão do CEO): trigger AFTER INSERT/UPDATE de valor_pago em erp_receber materializa
-- uma baixa para o DELTA entre valor_pago e a SOMA DAS BAIXAS ATIVAS (não contra OLD):
--     delta = NEW.valor_pago - COALESCE(SUM(erp_receber_baixa.valor WHERE receber_id=NEW.id, ativo), 0)
-- Contra a soma das baixas o guarda é IDEMPOTENTE: quando o subsistema já fez o certo (inseriu baixa E
-- atualizou valor_pago — o que o PR3 fará na conciliação), delta=0 e nenhuma segunda baixa nasce. E o
-- próprio recompute (que faz valor_pago = soma) devolve delta=0, então o guarda termina sozinho — sem
-- recursão infinita e sem precisar de flag.
--
-- delta<>0 → baixa origem='trigger_guarda', valor=delta (negativo = estorno, como as 3 do PR1),
-- data=NEW.data_pagamento (ou hoje se nula), autoria auth.uid().
-- + Backfill de fechamento da janela PR1↔PR2 (origem='migracao_pr2'): todo título com soma(baixas)≠
--   valor_pago ganha uma baixa de ajuste, preservando data_pagamento.
--
-- RD-52 (arquivo=ledger) · RD-38 (provado no dado).

-- 1) Recompute do PR1: só grava quando muda (evita churn/outbox/psgc e fecha a terminação do guarda).
CREATE OR REPLACE FUNCTION public.fn_receber_baixa_recompute()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rid  uuid;
  v_soma numeric;
BEGIN
  v_rid := COALESCE(NEW.receber_id, OLD.receber_id);
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_receber_baixa b
    WHERE b.receber_id = v_rid AND b.deleted_at IS NULL;
  UPDATE public.erp_receber
     SET valor_pago = v_soma, updated_at = now()
   WHERE id = v_rid AND COALESCE(valor_pago,0) IS DISTINCT FROM v_soma;
  RETURN NULL;
END;
$function$;

-- 2) Backfill de fechamento da janela (antes de instalar o guarda; fecha o histórico).
INSERT INTO public.erp_receber_baixa (receber_id, company_id, valor, data, origem, criado_em)
SELECT r.id, r.company_id, round(COALESCE(r.valor_pago,0) - COALESCE(b.s,0), 2),
       COALESCE(r.data_pagamento, r.data_emissao, CURRENT_DATE), 'migracao_pr2', now()
FROM public.erp_receber r
LEFT JOIN (SELECT receber_id, SUM(valor) s FROM public.erp_receber_baixa WHERE deleted_at IS NULL GROUP BY receber_id) b
  ON b.receber_id = r.id
WHERE r.deleted_at IS NULL
  AND r.company_id IS NOT NULL
  AND round(COALESCE(r.valor_pago,0),2) <> round(COALESCE(b.s,0),2);

-- 3) Trigger-guarda: qualquer escrita de valor_pago vira baixa (delta contra a soma das baixas).
CREATE OR REPLACE FUNCTION public.fn_receber_valor_pago_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_soma  numeric;
  v_delta numeric;
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NULL; -- título sem empresa é anomalia; não quebra o pagamento (RLS exige company_id na baixa)
  END IF;
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_receber_baixa b
    WHERE b.receber_id = NEW.id AND b.deleted_at IS NULL;
  v_delta := round(COALESCE(NEW.valor_pago,0) - v_soma, 2);
  IF v_delta <> 0 THEN
    INSERT INTO public.erp_receber_baixa (receber_id, company_id, valor, data, origem, criado_por, criado_em)
    VALUES (NEW.id, NEW.company_id, v_delta, COALESCE(NEW.data_pagamento, CURRENT_DATE), 'trigger_guarda', auth.uid(), now());
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_receber_valor_pago_guard ON public.erp_receber;
CREATE TRIGGER trg_receber_valor_pago_guard
  AFTER INSERT OR UPDATE OF valor_pago ON public.erp_receber
  FOR EACH ROW EXECUTE FUNCTION public.fn_receber_valor_pago_guard();
