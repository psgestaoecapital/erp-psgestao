-- ============================================================
-- #78 · Treinamento NR com validade cadastrada aparece "sem validade" na aba do funcionário
-- ============================================================
-- Causa (provada no dado): validade_ate em nr_turma_presenca era calculada SÓ pelo caminho de
-- salvar a turma. Presenças criadas por outro caminho (retrosync/importação/inclusão avulsa)
-- ficaram com validade_ate NULL — a Matriz lê essa coluna e mostra "Sem validade", mesmo com o
-- tipo tendo validade_meses. Ex.: turma 9243cd8b (realizada, 12/06/2026, validade 12m) → 0/8
-- presenças com validade; turma 1e9dd47d (mesmo tipo) → 18/18. Não havia trigger na tabela.
--
-- Correção durável (não depende de qual caminho cria a presença):
--   1) trigger BEFORE INSERT/UPDATE: se presente e validade_ate NULL, calcula
--      data_realizacao + validade_meses (só com turma 'realizada' e validade_meses definido).
--      Só PREENCHE o vazio — nunca sobrescreve uma validade já gravada (respeita ajuste manual).
--   2) backfill dos NULL existentes pela mesma regra. validade_ate é campo DERIVADO (não é dado
--      importado do relógio) — preencher a partir de data_realizacao+validade_meses é cálculo, não
--      alteração de fonte.

CREATE OR REPLACE FUNCTION public.fn_nr_presenca_calc_validade()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.validade_ate IS NULL AND COALESCE(NEW.presente, false) THEN
    SELECT (t.data_realizacao + make_interval(months => tt.validade_meses))::date
      INTO NEW.validade_ate
      FROM public.nr_turma t
      JOIN public.nr_treinamento_tipo tt ON tt.id = t.tipo_id
     WHERE t.id = NEW.turma_id
       AND t.status = 'realizada'
       AND tt.validade_meses IS NOT NULL
       AND t.data_realizacao IS NOT NULL;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_nr_presenca_calc_validade ON public.nr_turma_presenca;
CREATE TRIGGER trg_nr_presenca_calc_validade
  BEFORE INSERT OR UPDATE ON public.nr_turma_presenca
  FOR EACH ROW EXECUTE FUNCTION public.fn_nr_presenca_calc_validade();

-- backfill: preenche só o que está NULL, pela mesma regra do trigger
UPDATE public.nr_turma_presenca p
   SET validade_ate = (t.data_realizacao + make_interval(months => tt.validade_meses))::date
  FROM public.nr_turma t
  JOIN public.nr_treinamento_tipo tt ON tt.id = t.tipo_id
 WHERE p.turma_id = t.id
   AND p.validade_ate IS NULL
   AND COALESCE(p.presente, false)
   AND t.status = 'realizada'
   AND tt.validade_meses IS NOT NULL
   AND t.data_realizacao IS NOT NULL;
