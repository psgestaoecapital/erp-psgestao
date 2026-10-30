-- Chamado #5450 (Pdois): o código identificador do contrato nasce sozinho, em sequência por empresa e ano
-- (CI-AAAA-NNNN), separado do número CTR. Só preenche quando vier vazio; nunca repete (índice único parcial).
BEGIN;

-- Contratos antigos da Pdois (carteira da Jordana) com o campo vazio: preenche na ordem de criação.
WITH ord AS (
  SELECT id, 'CI-' || to_char(COALESCE(created_at, now()), 'YYYY') || '-' ||
         lpad(row_number() OVER (PARTITION BY company_id, to_char(COALESCE(created_at, now()), 'YYYY')
                                 ORDER BY created_at, id)::text, 4, '0') AS cod
  FROM public.erp_contratos
  WHERE company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7' AND codigo_identificador IS NULL
)
UPDATE public.erp_contratos c SET codigo_identificador = ord.cod FROM ord WHERE c.id = ord.id;

CREATE OR REPLACE FUNCTION public.fn_contrato_codigo_identificador_auto()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_ano text := to_char(COALESCE(NEW.created_at, now()), 'YYYY'); v_seq int;
BEGIN
  IF NULLIF(btrim(NEW.codigo_identificador), '') IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ctr_ci:' || NEW.company_id::text || v_ano, 0));
  SELECT COALESCE(max(substring(codigo_identificador FROM '^CI-' || v_ano || '-(\d+)$')::int), 0) + 1
    INTO v_seq FROM public.erp_contratos
   WHERE company_id = NEW.company_id AND codigo_identificador ~ ('^CI-' || v_ano || '-\d+$');
  NEW.codigo_identificador := 'CI-' || v_ano || '-' || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contrato_codigo_identificador_auto ON public.erp_contratos;
CREATE TRIGGER trg_contrato_codigo_identificador_auto BEFORE INSERT ON public.erp_contratos
  FOR EACH ROW EXECUTE FUNCTION public.fn_contrato_codigo_identificador_auto();

-- Só códigos gerados (CI-...) são únicos por empresa; códigos digitados antes (texto livre) não são tocados.
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_contratos_ci_auto ON public.erp_contratos (company_id, codigo_identificador)
  WHERE codigo_identificador ~ '^CI-\d{4}-\d+$';

COMMIT;
