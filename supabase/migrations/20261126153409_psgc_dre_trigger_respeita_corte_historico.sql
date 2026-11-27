-- RECONCILIAÇÃO DE LEDGER (Eng. Chefe 26/11): aplicada em produção FORA do repositório, via MCP (apply_migration,
-- 26/11 15:34 UTC), e travou o deploy-migrations. Conteúdo idêntico ao gravado no ledger; o db push não a reexecuta.
-- Guarda independente da função de recálculo: linhas da DRE anteriores ao corte histórico (ocultar_dre) não entram.
CREATE OR REPLACE FUNCTION public.fn_psgc_dre_guarda_corte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.ano IS NOT NULL AND NEW.mes IS NOT NULL AND EXISTS (
       SELECT 1 FROM erp_empresa_corte_historico ch
        WHERE ch.company_id = NEW.company_id AND ch.ocultar_dre
          AND (make_date(NEW.ano, NEW.mes, 1) + interval '1 month - 1 day')::date < ch.data_corte) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
-- O REVOKE abaixo NÃO estava no que foi aplicado via MCP; ele é executado de fato pela 20261128121545 (mesmo PR).
REVOKE ALL ON FUNCTION public.fn_psgc_dre_guarda_corte() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_psgc_dre_guarda_corte ON public.psgc_dre;
CREATE TRIGGER trg_psgc_dre_guarda_corte BEFORE INSERT OR UPDATE ON public.psgc_dre
  FOR EACH ROW EXECUTE FUNCTION public.fn_psgc_dre_guarda_corte();

DELETE FROM public.psgc_dre d USING public.erp_empresa_corte_historico ch
 WHERE ch.company_id = d.company_id AND ch.ocultar_dre
   AND (make_date(d.ano, d.mes, 1) + interval '1 month - 1 day')::date < ch.data_corte;
