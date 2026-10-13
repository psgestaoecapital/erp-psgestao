-- RD-41 Fase 1.1 — Conciliar = Baixa via TRIGGER canonico.
-- Interceptar no dado: quando o vinculo lancamento_id/lancamento_tabela em
-- conciliacao_movimento e criado, disparamos a baixa em erp_pagar/erp_receber.
-- Quando o vinculo e removido (desvincular), estornamos se a baixa ainda casa
-- com a data_transacao do movimento (evita apagar pagamento manual posterior).
--
-- Ordem: nossa trigger e AFTER; a BEFORE trg_status_* em erp_pagar/erp_receber
-- normaliza o status a partir de data_pagamento + valor_pago
-- (fn_trg_status_lancamento). Basta setar data_pagamento + valor_pago aqui.
--
-- Multi-tenant: exige company_id do titulo == company_id do movimento.
-- Idempotencia: reaplicar o mesmo vinculo nao dispara segunda baixa.
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
BEGIN
  -- =========================================================
  -- CENARIO A: desvincular (UPDATE de valor -> NULL, ou swap A->B)
  -- Estorna a baixa SE a data_pagamento atual == data_transacao do movimento.
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
  -- CENARIO B: vincular (INSERT ja com match, ou UPDATE NULL->valor / A->B)
  -- Aplica baixa: data_pagamento = data_transacao; valor_pago += movimento.valor.
  -- BEFORE trg_status_* normaliza o status.
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

    -- Idempotencia: se ja pago/cancelado, nao mexer.
    IF v_status_titulo IN ('aberto','parcial','vencido') THEN
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

REVOKE ALL ON FUNCTION public.fn_baixa_por_conciliacao() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_baixa_por_conciliacao ON public.conciliacao_movimento;
CREATE TRIGGER trg_baixa_por_conciliacao
AFTER INSERT OR UPDATE OF lancamento_id, lancamento_tabela
ON public.conciliacao_movimento
FOR EACH ROW
EXECUTE FUNCTION public.fn_baixa_por_conciliacao();
