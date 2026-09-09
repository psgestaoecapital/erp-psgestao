-- ============================================================
-- Fornecedor · documento em FONTE UNICA (cnpj_cpf <-> cpf_cnpj em sincronia)
-- Problema 2 (Jordana/KGF · Impave): a Impave da filial 0002-62 aparecia "sem CNPJ" e "nao
-- batia". Causa (RD-38, auditado): erp_fornecedores tem DUAS colunas para o mesmo documento —
-- cnpj_cpf e cpf_cnpj. Um fluxo de front criou o cadastro so com cnpj_cpf (cpf_cnpj nulo);
-- quem le/exibe/casa por cpf_cnpj ve nulo -> "sem CNPJ". Impacto medido: 4 linhas com um campo
-- preenchido e o outro nulo, 0 divergentes.
--
-- Fix (RD-30 — nao apaga nenhuma coluna, DERIVA): trigger que, sempre que um campo e preenchido
-- e o outro esta nulo, ESPELHA o valor no nulo. Nunca faz clobber (so preenche nulo). Vale para
-- INSERT e UPDATE, de qualquer writer (front, RPC, importador) — fonte unica sem trocar caller.
-- Backfill dos existentes inconsistentes junto.
--
-- Fora deste arquivo (outro facet do Problema 2): os 248 fornecedores "ambos nulos" (sem
-- documento nenhum) e o aviso "emitente nao cadastrado -> cadastrar com dados do XML" no fluxo de
-- entrada. Este arquivo resolve a dualidade (o que fez a Impave "nao bater").
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_fornecedor_sync_doc()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  -- espelha o campo preenchido no que estiver nulo. Se ambos preenchidos (iguais ou nao), NAO toca.
  IF NULLIF(btrim(COALESCE(NEW.cnpj_cpf,'')),'') IS NULL
     AND NULLIF(btrim(COALESCE(NEW.cpf_cnpj,'')),'') IS NOT NULL THEN
    NEW.cnpj_cpf := NEW.cpf_cnpj;
  ELSIF NULLIF(btrim(COALESCE(NEW.cpf_cnpj,'')),'') IS NULL
     AND NULLIF(btrim(COALESCE(NEW.cnpj_cpf,'')),'') IS NOT NULL THEN
    NEW.cpf_cnpj := NEW.cnpj_cpf;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fornecedor_sync_doc ON public.erp_fornecedores;
CREATE TRIGGER trg_fornecedor_sync_doc
  BEFORE INSERT OR UPDATE OF cnpj_cpf, cpf_cnpj ON public.erp_fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.fn_fornecedor_sync_doc();

-- backfill dos existentes: preenche SO o nulo (0 divergentes auditados, entao sem risco de clobber).
UPDATE public.erp_fornecedores SET cpf_cnpj = cnpj_cpf
  WHERE NULLIF(btrim(COALESCE(cpf_cnpj,'')),'') IS NULL
    AND NULLIF(btrim(COALESCE(cnpj_cpf,'')),'') IS NOT NULL;
UPDATE public.erp_fornecedores SET cnpj_cpf = cpf_cnpj
  WHERE NULLIF(btrim(COALESCE(cnpj_cpf,'')),'') IS NULL
    AND NULLIF(btrim(COALESCE(cpf_cnpj,'')),'') IS NOT NULL;
