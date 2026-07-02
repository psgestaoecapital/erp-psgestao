-- RD-41 Fase 1.1 · Bloco E — guard-rail auto-match no trigger.
-- Invariante CEO: match AUTOMATICO so baixa em valor CHEIO; parcial automatico
-- NAO baixa (fica pendente para revisao humana). Match manual (operador clica)
-- pode aplicar baixa parcial normalmente.
--
-- match_origem in ('auto','ouro','automatico','auto_ouro') = automatico.
-- Demais (manual, manual_titulo, etc) = humano.
-- Aplicada via MCP em 2026-07-02.

CREATE OR REPLACE FUNCTION public.fn_baixa_por_conciliacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_valor_titulo   numeric;
  v_status_titulo  text;
  v_company_titulo uuid;
  v_data_pgto_old  date;
  v_is_auto        boolean;
  v_cheio          boolean;
BEGIN
  -- =========================================================
  -- CENARIO A: desvincular (UPDATE valor -> NULL, ou swap A->B) — estorno
  -- Inalterado: so estorna se data_pagamento ainda casa com data_transacao
  -- do movimento (nao apaga pagamento manual posterior).
  -- =========================================================
  IF TG_OP = 'UPDATE'
     AND OLD.lancamento_id IS NOT NULL
     AND OLD.lancamento_tabela IN ('erp_pagar','erp_receber')
     AND (
       NEW.lancamento_id IS NULL
       OR NEW.lancamento_id IS DISTINCT FROM OLD.lancamento_id
       OR NEW.lancamento_tabela IS DISTINCT FROM OLD.lancamento_tabela
     )
  THEN
    IF OLD.lancamento_tabela = 'erp_pagar' THEN
      SELECT data_pagamento INTO v_data_pgto_old
        FROM public.erp_pagar WHERE id = OLD.lancamento_id;
      IF v_data_pgto_old IS NOT DISTINCT FROM OLD.data_transacao THEN
        UPDATE public.erp_pagar
           SET status = 'aberto',
               valor_pago = 0,
               data_pagamento = NULL,
               forma_pagamento = NULL,
               updated_at = now()
         WHERE id = OLD.lancamento_id;
      END IF;
    ELSIF OLD.lancamento_tabela = 'erp_receber' THEN
      SELECT data_pagamento INTO v_data_pgto_old
        FROM public.erp_receber WHERE id = OLD.lancamento_id;
      IF v_data_pgto_old IS NOT DISTINCT FROM OLD.data_transacao THEN
        UPDATE public.erp_receber
           SET status = 'aberto',
               valor_pago = 0,
               data_pagamento = NULL,
               forma_pagamento = NULL,
               updated_at = now()
         WHERE id = OLD.lancamento_id;
      END IF;
    END IF;
  END IF;

  -- =========================================================
  -- CENARIO B: vincular (INSERT com match ou UPDATE NULL->valor / A->B)
  -- Guard-rail: match automatico exige valor cheio; manual pode parcial.
  -- =========================================================
  IF NEW.lancamento_id IS NOT NULL
     AND NEW.lancamento_tabela IN ('erp_pagar','erp_receber')
     AND (
       TG_OP = 'INSERT'
       OR OLD.lancamento_id IS DISTINCT FROM NEW.lancamento_id
       OR OLD.lancamento_tabela IS DISTINCT FROM NEW.lancamento_tabela
     )
  THEN
    IF NEW.lancamento_tabela = 'erp_pagar' THEN
      SELECT valor, status, company_id
        INTO v_valor_titulo, v_status_titulo, v_company_titulo
        FROM public.erp_pagar WHERE id = NEW.lancamento_id;
    ELSE
      SELECT valor, status, company_id
        INTO v_valor_titulo, v_status_titulo, v_company_titulo
        FROM public.erp_receber WHERE id = NEW.lancamento_id;
    END IF;

    IF v_company_titulo IS NULL THEN
      RAISE EXCEPTION 'fn_baixa_por_conciliacao: titulo % nao encontrado em %',
        NEW.lancamento_id, NEW.lancamento_tabela;
    END IF;
    IF v_company_titulo <> NEW.company_id THEN
      RAISE EXCEPTION 'fn_baixa_por_conciliacao: multi-tenant violacao — titulo %/company %, movimento %/company %',
        NEW.lancamento_id, v_company_titulo, NEW.id, NEW.company_id;
    END IF;

    v_is_auto := LOWER(COALESCE(NEW.match_origem,'')) IN ('auto','ouro','automatico','auto_ouro');
    v_cheio   := (NEW.valor = v_valor_titulo);

    -- Automatico so baixa em valor cheio; manual sempre baixa (parcial vira 'parcial').
    IF v_status_titulo IN ('aberto','parcial','vencido')
       AND (v_cheio OR NOT v_is_auto)
    THEN
      IF NEW.lancamento_tabela = 'erp_pagar' THEN
        UPDATE public.erp_pagar
           SET valor_pago = COALESCE(valor_pago, 0) + NEW.valor,
               data_pagamento = NEW.data_transacao,
               forma_pagamento = COALESCE(NULLIF(forma_pagamento, ''), 'conciliacao_bancaria'),
               updated_at = now()
         WHERE id = NEW.lancamento_id;
      ELSE
        UPDATE public.erp_receber
           SET valor_pago = COALESCE(valor_pago, 0) + NEW.valor,
               data_pagamento = NEW.data_transacao,
               forma_pagamento = COALESCE(NULLIF(forma_pagamento, ''), 'conciliacao_bancaria'),
               updated_at = now()
         WHERE id = NEW.lancamento_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $fn$;
