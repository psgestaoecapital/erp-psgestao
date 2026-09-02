-- DEMO-F1 parte 3 · §3.2 DEFESA nas consolidadas (RD-57, defesa não conserto).
-- fn_psgc_dre_consolidada / fn_psgc_saude_consolidada / fn_psgc_abc_consolidado RECEBEM p_company_ids
-- uuid[] — não escolhem. Se um chamador passar a demo, ela entra no consolidado. A defesa intersecta
-- a lista recebida com fn_empresas_produtivas() logo no início. Patch cirúrgico e idempotente.
--
-- Prova (ROLLBACK): a DRE consolidada só-demo caía de R$160.550 (17 "empresas") para R$0/0 depois da
-- defesa, e uma empresa de produção seguia retornando R$6.694.145 (sem regressão).

DO $mig$
DECLARE r record; v_def text; v_new text; v_n int;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_psgc_dre_consolidada','fn_psgc_saude_consolidada','fn_psgc_abc_consolidado')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def ILIKE '%fn_empresas_produtivas%' THEN CONTINUE; END IF;  -- já defendida
    v_n := (length(v_def) - length(replace(v_def, E'\nBEGIN\n', ''))) / length(E'\nBEGIN\n');
    IF v_n <> 1 THEN RAISE EXCEPTION 'defesa: % tem % BEGIN de topo — abortando', r.proname, v_n; END IF;
    v_new := replace(v_def, E'\nBEGIN\n',
      E'\nBEGIN\n  p_company_ids := ARRAY(SELECT unnest(p_company_ids) INTERSECT SELECT fn_empresas_produtivas());  -- [DEMO-F1 p3] defesa: so producao no consolidado\n\n');
    EXECUTE v_new;
  END LOOP;
END $mig$;
