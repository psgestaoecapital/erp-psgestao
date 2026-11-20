-- RD-41 · PR-1 · Blindagem do trigger-guarda de valor_pago (receber + pagar) contra valor absurdo.
-- Code: code-desenvolvedor-3 · NÚCLEO FINANCEIRO · incidente "main vermelha 29h" (DEMO GE).
--
-- PROVA (RD-38, produção, 20/11): títulos "Mensalidade E2E <runid>" na DEMO GE (b07…004) com
-- valor/valor_pago = 9.999.999.999.999,99 (teto do numeric(15,2)). O guarda espelha o delta
-- valor_pago − soma_baixas numa baixa origem 'trigger_guarda' → 187 baixas de ~R$ 9,99 trilhões, que
-- inflaram o REALIZADO do fluxo de caixa e estouraram o float do spec ge-fluxo-caixa-realizado-ledger.
-- Só DEMO: 0 baixas e 0 títulos acima de R$ 100 bi em qualquer outra empresa. Hoje 0 baixas vivas
-- (o Eng. Chefe já soft-deletou as 187).
--
-- CORREÇÃO: as duas funções ficam IDÊNTICAS à definição viva (pg_get_functiondef conferido em 20/11:
-- 20260923290000 receber; 20261031120120 pagar, com a origem 'retorno_cnab'), mais UM bloco: se o delta
-- a materializar ou o próprio valor_pago passar do TETO DE SANIDADE (1e11 = R$ 100 bilhões), a baixa
-- NÃO é gerada e sai um RAISE WARNING (não quebra a escrita do título; só não materializa lixo).
-- Teto: muito acima de qualquer título real de PME, muito abaixo do teto do numérico (≈1e13). Rever se um
-- cliente real legítimo passar disso (hoje nenhum passa). Caminho normal (delta sadio) inalterado.
-- Decisão default: WARNING + pular. A alternativa dura (RAISE EXCEPTION) fica para o CEO decidir.
--
-- BACKFILL idempotente: soft-delete (deleted_at; reversível) de baixa 'trigger_guarda' VIVA com |valor|
-- acima do teto. Usa |valor| para não deixar viva a metade negativa de um par +teto/−teto (sobraria
-- valor_pago negativo absurdo no título). O recompute de cada título roda sozinho (trigger da baixa).
-- Hoje afeta 0 linhas; deixa a migration auto-suficiente. Não toca baixa legítima.
--
-- RD-52 (arquivo = ledger) · RD-38 (provado no dado) · RD-55 (sem backfill em dado legítimo).

CREATE OR REPLACE FUNCTION public.fn_receber_valor_pago_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_soma  numeric;
  v_delta numeric;
  v_teto  numeric := 100000000000; -- 1e11 = R$ 100 bi: teto de sanidade (RD-41)
BEGIN
  IF NEW.company_id IS NULL THEN
    RETURN NULL; -- título sem empresa é anomalia; não quebra o pagamento (RLS exige company_id na baixa)
  END IF;
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_receber_baixa b
    WHERE b.receber_id = NEW.id AND b.deleted_at IS NULL;
  v_delta := round(COALESCE(NEW.valor_pago,0) - v_soma, 2);
  IF v_delta <> 0 THEN
    IF abs(v_delta) > v_teto OR abs(COALESCE(NEW.valor_pago,0)) > v_teto THEN
      RAISE WARNING 'valor_pago_guard[receber]: valor absurdo barrado (titulo %, valor_pago %, delta %) — baixa NAO gerada',
                    NEW.id, NEW.valor_pago, v_delta;
      RETURN NULL; -- não materializa lixo
    END IF;
    INSERT INTO public.erp_receber_baixa (receber_id, company_id, valor, data, origem, criado_por, criado_em)
    VALUES (NEW.id, NEW.company_id, v_delta, COALESCE(NEW.data_pagamento, CURRENT_DATE), 'trigger_guarda', auth.uid(), now());
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pagar_valor_pago_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_soma  numeric;
  v_delta numeric;
  v_teto  numeric := 100000000000; -- 1e11 = R$ 100 bi: teto de sanidade (RD-41)
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_pagar_baixa b
    WHERE b.pagar_id = NEW.id AND b.deleted_at IS NULL;
  v_delta := round(COALESCE(NEW.valor_pago,0) - v_soma, 2);
  IF v_delta <> 0 THEN
    IF abs(v_delta) > v_teto OR abs(COALESCE(NEW.valor_pago,0)) > v_teto THEN
      RAISE WARNING 'valor_pago_guard[pagar]: valor absurdo barrado (titulo %, valor_pago %, delta %) — baixa NAO gerada',
                    NEW.id, NEW.valor_pago, v_delta;
      RETURN NULL; -- não materializa lixo
    END IF;
    INSERT INTO public.erp_pagar_baixa (pagar_id, company_id, valor, data, forma, origem, criado_por, criado_em)
    VALUES (NEW.id, NEW.company_id, v_delta, COALESCE(NEW.data_pagamento, CURRENT_DATE), NEW.forma_pagamento,
            CASE WHEN lower(COALESCE(NEW.forma_pagamento,'')) = 'cnab' THEN 'retorno_cnab' ELSE 'trigger_guarda' END,
            auth.uid(), now());
  END IF;
  RETURN NULL;
END;
$function$;

-- Backfill (idempotente): nenhuma baixa 'trigger_guarda' acima do teto fica viva.
DO $$
DECLARE v_rec int; v_pag int;
BEGIN
  UPDATE public.erp_receber_baixa SET deleted_at = now()
   WHERE origem = 'trigger_guarda' AND abs(valor) > 100000000000 AND deleted_at IS NULL;
  GET DIAGNOSTICS v_rec = ROW_COUNT;
  UPDATE public.erp_pagar_baixa SET deleted_at = now()
   WHERE origem = 'trigger_guarda' AND abs(valor) > 100000000000 AND deleted_at IS NULL;
  GET DIAGNOSTICS v_pag = ROW_COUNT;
  RAISE NOTICE 'RD-41 backfill: % baixa(s) de receber e % de pagar acima do teto soft-deletadas', v_rec, v_pag;
END $$;
