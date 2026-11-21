-- PDCA GE · /dashboard/cadastros/clientes · item1 (auditor_pdca_2, 17/11/2026)
-- Mantém erp_clientes.cnpj_cpf (text) e cpf_cnpj (varchar 18) SEMPRE em sincronia por
-- trigger BEFORE INSERT OR UPDATE. Raiz do defeito: o cadastro grava só cnpj_cpf e o
-- CRM/Receita grava só cpf_cnpj; sem sincronia, busca/exibição perdiam cliente criado
-- pela outra origem (os paliativos de LEITURA já estão na main; aqui garantimos a ESCRITA).
--
-- SEGURANÇA / RD-38:
--   * ADITIVO: cria função + trigger novos; NÃO faz backfill destrutivo, NÃO altera nem
--     apaga dado de cliente existente (linhas antigas já cobertas pelos paliativos de leitura).
--   * Fonte = a coluna recém-informada/alterada; a irmã recebe o MESMO valor, inclusive NULL
--     (limpeza intencional não é ressuscitada).
--   * cpf_cnpj é varchar(18): ao copiar de cnpj_cpf (text) só propaga se couber (<=18), para
--     nunca estourar o tipo e quebrar uma escrita válida.
--   * Ordem alfabética dos BEFORE triggers: "trg_clientes_cnpj_cpf_sync" roda ANTES de
--     "trg_clientes_cnpj_duplicado_guarda" (cnpj_c... < cnpj_d...), então o guarda de
--     duplicidade já vê as duas colunas populadas.
--   * Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS + CREATE TRIGGER.

CREATE OR REPLACE FUNCTION public.fn_clientes_documento_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cnpj_cpf IS NOT NULL AND NEW.cpf_cnpj IS NULL AND char_length(NEW.cnpj_cpf) <= 18 THEN
      NEW.cpf_cnpj := NEW.cnpj_cpf;
    ELSIF NEW.cpf_cnpj IS NOT NULL AND NEW.cnpj_cpf IS NULL THEN
      NEW.cnpj_cpf := NEW.cpf_cnpj;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: a coluna que MUDOU é a fonte; a irmã recebe o mesmo valor (inclui NULL intencional).
  IF NEW.cnpj_cpf IS DISTINCT FROM OLD.cnpj_cpf
     AND NEW.cpf_cnpj IS NOT DISTINCT FROM OLD.cpf_cnpj THEN
    IF NEW.cnpj_cpf IS NULL OR char_length(NEW.cnpj_cpf) <= 18 THEN
      NEW.cpf_cnpj := NEW.cnpj_cpf;
    END IF;
  ELSIF NEW.cpf_cnpj IS DISTINCT FROM OLD.cpf_cnpj
     AND NEW.cnpj_cpf IS NOT DISTINCT FROM OLD.cnpj_cpf THEN
    NEW.cnpj_cpf := NEW.cpf_cnpj;
  ELSIF NEW.cnpj_cpf IS DISTINCT FROM OLD.cnpj_cpf
     AND NEW.cpf_cnpj IS DISTINCT FROM OLD.cpf_cnpj THEN
    -- ambas mudaram: cnpj_cpf é a coluna canônica do cadastro oficial; se divergirem, a irmã a segue.
    IF NEW.cnpj_cpf IS DISTINCT FROM NEW.cpf_cnpj
       AND (NEW.cnpj_cpf IS NULL OR char_length(NEW.cnpj_cpf) <= 18) THEN
      NEW.cpf_cnpj := NEW.cnpj_cpf;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_clientes_documento_sync() IS
  'PDCA GE cadastros/clientes item1: mantém erp_clientes.cnpj_cpf e cpf_cnpj em sincronia (aditivo, sem backfill destrutivo). Roda antes do guarda de duplicidade.';

DROP TRIGGER IF EXISTS trg_clientes_cnpj_cpf_sync ON public.erp_clientes;
CREATE TRIGGER trg_clientes_cnpj_cpf_sync
  BEFORE INSERT OR UPDATE OF cpf_cnpj, cnpj_cpf
  ON public.erp_clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_clientes_documento_sync();
