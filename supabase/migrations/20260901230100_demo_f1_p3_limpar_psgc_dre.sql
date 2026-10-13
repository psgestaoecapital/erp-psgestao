-- DEMO-F1 parte 3 · §2 LIMPAR — remove as linhas da demo de psgc_dre.
-- Roda DEPOIS do guard (timestamp maior). Com o guard vivo, o worker não as recria.
-- Trava de segurança (RD-54/55): captura a contagem de PRODUÇÃO antes e depois; se mudar 1 linha
-- que seja, ABORTA. Um DELETE por company_id da demo não pode tocar produção — a trava é defesa.

DO $mig$
DECLARE v_prod_antes int; v_prod_depois int; v_demo int;
BEGIN
  SELECT count(*) INTO v_prod_antes FROM psgc_dre WHERE company_id IN (SELECT fn_empresas_produtivas());

  DELETE FROM psgc_dre WHERE company_id = 'ded00000-0000-4000-a000-000000000001';

  SELECT count(*) INTO v_demo FROM psgc_dre WHERE company_id = 'ded00000-0000-4000-a000-000000000001';
  SELECT count(*) INTO v_prod_depois FROM psgc_dre WHERE company_id IN (SELECT fn_empresas_produtivas());

  IF v_demo <> 0 THEN
    RAISE EXCEPTION '[DEMO-F1 p3] demo ainda tem % linhas em psgc_dre — abortando', v_demo;
  END IF;
  IF v_prod_depois <> v_prod_antes THEN
    RAISE EXCEPTION '[DEMO-F1 p3] contagem de producao mudou de % para % — abortando (nenhuma real pode perder linha)', v_prod_antes, v_prod_depois;
  END IF;
  RAISE NOTICE '[DEMO-F1 p3] psgc_dre da demo zerada; producao intacta (% linhas)', v_prod_depois;
END $mig$;
