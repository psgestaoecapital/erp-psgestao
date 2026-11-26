-- conserto-main (RD-52) · reconciliação do 2º órfão do ledger — deploy-migrations VERMELHO na main.
--
-- O ledger de produção (supabase_migrations.schema_migrations) tinha a versão 20261126153409
-- (name: psgc_dre_trigger_respeita_corte_historico) SEM arquivo correspondente no repositório —
-- aplicada à mão em produção (carimbo do apply_migration, 2026-11-26 15:34:09), violando a RD-52.
-- Com isso o `supabase db push --include-all` abortava com
-- "Remote migration versions not found in local migrations directory" (apontando 20261126142432
-- E 20261126153409) e segurava TODAS as migrations — a esteira inteira travada.
--
-- Prova RD-38 (produção, 26/11): a versão existe no ledger com estes exatos statements; nenhum
-- arquivo em nenhum ref do repo os contém (git ls-tree/grep/log -S = 0). O conteúdo JÁ está
-- aplicado (função, trigger e expurgo das linhas pré-corte já rodaram). Este arquivo apenas
-- DOCUMENTA o que rodou, com a MESMA versão do ledger, para o db push voltar a bater
-- arquivo↔ledger (verde). Como a versão permanece marcada como aplicada no ledger, o db push a
-- IGNORA — não re-executa o DELETE em psgc_dre nem recria a trigger em produção. Todos os passos
-- são idempotentes (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, DELETE com a mesma guarda de corte),
-- então um replay em banco de testes/novo reproduz fielmente o estado de produção sem efeito duplo.
--
-- Origem a auditar (RD-52/RD-103): algum Code aplicou esta migration de DRE via apply_migration/
-- execute_sql sem abrir o arquivo no PR. Alertado ao eng_chefe/CEO no handoff.

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

DROP TRIGGER IF EXISTS trg_psgc_dre_guarda_corte ON public.psgc_dre;
CREATE TRIGGER trg_psgc_dre_guarda_corte BEFORE INSERT OR UPDATE ON public.psgc_dre
  FOR EACH ROW EXECUTE FUNCTION public.fn_psgc_dre_guarda_corte();

DELETE FROM public.psgc_dre d USING public.erp_empresa_corte_historico ch
 WHERE ch.company_id = d.company_id AND ch.ocultar_dre
   AND (make_date(d.ano, d.mes, 1) + interval '1 month - 1 day')::date < ch.data_corte;
