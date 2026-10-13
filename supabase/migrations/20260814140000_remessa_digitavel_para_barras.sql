-- RD-41 · Fase 1 (Saneamento) — Remessa: normaliza linha digitável (47/48) → código de barras (44).
-- Origem: boleto UNIMED KGF R$ 1.071,24 não entrava na remessa (linha de 47 gravada no campo de barras).
-- Fonte única de verdade (RD-52): a normalização acontece no banco (função + trigger), então qualquer
-- entrada (manual, API, cron, import — RD-57) grava sempre os 44. Arquivo migration (sem BEGIN/COMMIT,
-- sem SELECT solto). Provado no banco: 47 UNIMED → 75691153900001071241303901006544705431323001 (DV mod11 OK).

-- ── 1) Função canônica de conversão digitável → código de barras (44) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_boleto_digitavel_para_barras(p_entrada text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text; n int; barcode text; base43 text;
  soma int := 0; i int; resto int; dv int;
BEGIN
  d := regexp_replace(COALESCE(p_entrada,''), '[^0-9]', '', 'g');
  n := length(d);

  IF n = 44 THEN
    barcode := d;                                   -- já é código de barras
  ELSIF n = 47 THEN                                 -- boleto bancário (5 campos)
    barcode := substr(d,1,3)||substr(d,4,1)||substr(d,33,1)||substr(d,34,14)
             ||substr(d,5,5)||substr(d,11,10)||substr(d,22,10);
  ELSIF n = 48 THEN                                 -- arrecadação/convênio (4 blocos de 12)
    barcode := substr(d,1,11)||substr(d,13,11)||substr(d,25,11)||substr(d,37,11);
  ELSE
    RETURN NULL;                                    -- comprimento inválido
  END IF;

  IF length(barcode) <> 44 THEN RETURN NULL; END IF;

  -- Validação DV geral (mod11) apenas para boleto bancário (44/47).
  IF n IN (44,47) THEN
    base43 := substr(barcode,1,4)||substr(barcode,6,39);
    soma := 0;
    FOR i IN 0..42 LOOP
      soma := soma + substr(base43, 43-i, 1)::int * (2 + (i % 8));
    END LOOP;
    resto := soma % 11;
    dv := 11 - resto;
    IF dv IN (0,10,11) THEN dv := 1; END IF;
    IF substr(barcode,5,1)::int <> dv THEN
      RETURN NULL;                                  -- DV não confere → digitável inválida
    END IF;
  END IF;

  RETURN barcode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_boleto_digitavel_para_barras(text) TO authenticated;

-- ── 2) Trigger de normalização em erp_pagar (grava sempre os 44) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_erp_pagar_normaliza_barras()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_len int; v_conv text;
BEGIN
  IF NEW.codigo_barras IS NOT NULL THEN
    v_len := length(regexp_replace(NEW.codigo_barras,'[^0-9]','','g'));
    IF v_len IN (47,48) THEN
      v_conv := public.fn_boleto_digitavel_para_barras(NEW.codigo_barras);
      IF v_conv IS NOT NULL THEN
        NEW.codigo_barras := v_conv;                -- normaliza para 44
      END IF;
      -- v_conv NULL → mantém o valor original; a UI sinaliza "inválido"
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_erp_pagar_normaliza_barras ON public.erp_pagar;
CREATE TRIGGER trg_erp_pagar_normaliza_barras
  BEFORE INSERT OR UPDATE OF codigo_barras ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION public.trg_erp_pagar_normaliza_barras();

-- ── 3) Backfill dos registros existentes (RD-54: backup antes) ─────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS bkp;
CREATE TABLE IF NOT EXISTS bkp._bkp_pagar_barras_20260814 AS
  SELECT id, company_id, codigo_barras
  FROM public.erp_pagar
  WHERE length(regexp_replace(COALESCE(codigo_barras,''),'[^0-9]','','g')) IN (47,48);

UPDATE public.erp_pagar
SET codigo_barras = public.fn_boleto_digitavel_para_barras(codigo_barras)
WHERE length(regexp_replace(COALESCE(codigo_barras,''),'[^0-9]','','g')) IN (47,48)
  AND public.fn_boleto_digitavel_para_barras(codigo_barras) IS NOT NULL;
