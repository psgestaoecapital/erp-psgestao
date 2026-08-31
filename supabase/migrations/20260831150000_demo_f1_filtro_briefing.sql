-- DEMO-F1 §2.2 · Aplica a régua de produtivas nos agregadores gerenciais (PARTE 1: fn_briefing_sessao).
-- Técnica cirúrgica: pega a definição VIVA da função e troca só a âncora exata (o 'FROM companies)'
-- do empresas_resumo → 'FROM companies_producao)'). Zero transcrição manual → zero risco de regressão
-- (RD-53). Guard aborta se a âncora não existir ou aparecer mais de uma vez.
-- Demais agregadores (psgc_*, supervisor_dashboard, sync_*, truth_audit, views) entram em migrations
-- seguintes desta série, após a triagem §6.6 ser confirmada.

DO $$
DECLARE v_def text; v_new text; v_ocorr int;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='fn_briefing_sessao' AND pronamespace='public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_briefing_sessao nao encontrada'; END IF;
  v_ocorr := (length(v_def) - length(replace(v_def,'FROM companies),',''))) / length('FROM companies),');
  IF v_ocorr <> 1 THEN RAISE EXCEPTION 'esperava 1 ancora FROM companies), achei %', v_ocorr; END IF;
  v_new := replace(v_def, 'FROM companies),', 'FROM companies_producao),');
  EXECUTE v_new;
END $$;
