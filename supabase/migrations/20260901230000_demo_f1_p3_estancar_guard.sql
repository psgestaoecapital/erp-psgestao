-- DEMO-F1 parte 3 · §1 ESTANCAR — guard na fonte que grava psgc_dre.
-- fn_psgc_recalcular_dre_mes é o ÚNICO ponto que escreve em psgc_dre (auditado). O psgc-worker
-- (*/5) o chama e, sem guard, reescreve as 7 linhas da demo em todo ciclo de recálculo. O guard
-- barra tenant demo/sandbox logo no início — só 'producao' entra na DRE.
--
-- Patch CIRÚRGICO e IDEMPOTENTE (a SPEC exige preservar o resto byte a byte): pega a definição
-- atual, insere o guard logo após o BEGIN de topo (com trava de ocorrência: exatamente 1 BEGIN),
-- e reaplica. Se o guard já está lá, é no-op. Assinatura real confirmada: (p_company_id, p_ano, p_mes),
-- empresa única → o guard é um RETURN (não a variante multi-empresa).

DO $mig$
DECLARE v_def text; v_new text; v_n int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_psgc_recalcular_dre_mes'
       AND pg_get_functiondef(p.oid) ILIKE '%ambiente_tenant%'
  ) THEN
    RAISE NOTICE '[DEMO-F1 p3] guard já presente em fn_psgc_recalcular_dre_mes — nada a fazer';
    RETURN;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_psgc_recalcular_dre_mes';
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_psgc_recalcular_dre_mes não encontrada'; END IF;

  v_n := (length(v_def) - length(replace(v_def, E'\nBEGIN\n', ''))) / length(E'\nBEGIN\n');
  IF v_n <> 1 THEN RAISE EXCEPTION 'esperava 1 BEGIN de topo, achei % — abortando para não corromper', v_n; END IF;

  v_new := replace(v_def, E'\nBEGIN\n',
    E'\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND ambiente_tenant = ''producao'') THEN\n    RETURN;  -- [DEMO-F1 p3] tenant demo/sandbox nao entra na DRE\n  END IF;\n\n');
  EXECUTE v_new;
  RAISE NOTICE '[DEMO-F1 p3] guard instalado em fn_psgc_recalcular_dre_mes';
END $mig$;
