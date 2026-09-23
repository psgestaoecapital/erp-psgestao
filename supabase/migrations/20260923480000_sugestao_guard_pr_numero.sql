-- BLOCO 1.3 (decisão do CEO 23/09, a partir da reclamação do Rodrigo): 'em_desenvolvimento' EXIGE
-- pr_numero. Sem PR, o chamado NÃO sai de 'nova' — a resposta escrita fica na thread com status 'nova'.
-- Impede a reincidência do buraco de credibilidade: 18 de 23 chamados estavam em 'em_desenvolvimento'
-- SEM PR (respondidos, nunca construídos). Coerção silenciosa (não RAISE): preserva a resposta,
-- só nega alegar "em desenvolvimento" sem PR. Trigger comum (SECURITY INVOKER) → fora do gate fn-guards.

CREATE OR REPLACE FUNCTION public.fn_sugestao_guard_pr_numero()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.status = 'em_desenvolvimento' AND NEW.pr_numero IS NULL THEN
    NEW.status := 'nova';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sugestao_guard_pr_numero ON public.sugestoes;
CREATE TRIGGER trg_sugestao_guard_pr_numero
  BEFORE INSERT OR UPDATE ON public.sugestoes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sugestao_guard_pr_numero();
