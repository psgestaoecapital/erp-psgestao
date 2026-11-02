-- PDCA Hub · /dashboard/projetos/mao-obra (Construtora Modelo - DEMO) — irriga a tela v2 (RD-38).
-- O código v2 (componentes de remuneração: fixo/produção/empreitada/diária/comissão/bônus/hora-extra/adicional,
-- 5 vínculos, custo COM/SEM hora-extra) já existe (src/lib/hub/custoMaoObra.ts), mas a DEMO só tinha fichas
-- CLT/PJ SEM nenhum componente — por isso o auditor via a tela "em construção". Esta migration ADITIVA cria
-- funções e fichas-perfil de DEMONSTRAÇÃO cobrindo os 5 vínculos e todos os tipos de componente.
-- SOMENTE a empresa DEMO Construtora (b0700000-0000-4000-a000-000000000006). Idempotente (sentinela na descrição).
-- Não toca dado de cliente, não altera regra de cálculo, não mexe em guards nem em financeiro.

DO $$
DECLARE
  v_co uuid := 'b0700000-0000-4000-a000-000000000006';
  v_fn uuid; v_fid uuid;
BEGIN
  -- só a empresa DEMO; se não existir, não faz nada
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_co) THEN RETURN; END IF;

  -- helper: cria/recupera a função
  -- (inline por bloco, sem função nova no schema)

  ---------------------------------------------------------------------------
  -- 1) Encarregado de obra · CLT mensal · fixo + hora-extra habitual + periculosidade + bônus
  ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo WHERE company_id=v_co AND descricao='Encarregado de obra (perfil DEMO v2)') THEN
    SELECT id INTO v_fn FROM erp_funcao_mao_obra WHERE company_id=v_co AND nome='Encarregado de obra' LIMIT 1;
    IF v_fn IS NULL THEN
      INSERT INTO erp_funcao_mao_obra (company_id,nome,cbo,forma_pagamento,he50_horas_padrao,custo_hora_usa_he)
      VALUES (v_co,'Encarregado de obra','7102-15','mensal',20,'com') RETURNING id INTO v_fn;
    END IF;
    INSERT INTO erp_mao_obra_custo (company_id,tipo,funcao_id,descricao,setor,vinculo,forma_pagamento,salario,adicional_periculosidade,horas_produtivas_mes,quantidade_pessoas,conferido,conferido_em,vigencia_inicio)
    VALUES (v_co,'perfil',v_fn,'Encarregado de obra (perfil DEMO v2)','Execução','clt','mensal',3800,30,220,1,true,now(),CURRENT_DATE) RETURNING id INTO v_fid;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,subtipo,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,0,'fixo','mensal',3800,0,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt','fixo','mensal') k;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,descricao,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,1,'hora_extra','HE habituais 50%',0,20,50,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt','hora_extra') k;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,subtipo,descricao,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,2,'adicional','periculosidade','Adicional de periculosidade',0,0,30,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt','adicional','periculosidade') k;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,descricao,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,3,'bonus','Bônus de desempenho',500,0,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt','bonus') k;
  END IF;

  ---------------------------------------------------------------------------
  -- 2) Gerente de contrato · CLT mensal · fixo + comissão sobre medição + bônus
  ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo WHERE company_id=v_co AND descricao='Gerente de contrato (perfil DEMO v2)') THEN
    SELECT id INTO v_fn FROM erp_funcao_mao_obra WHERE company_id=v_co AND nome='Gerente de contrato' LIMIT 1;
    IF v_fn IS NULL THEN
      INSERT INTO erp_funcao_mao_obra (company_id,nome,cbo,forma_pagamento) VALUES (v_co,'Gerente de contrato','1423-05','mensal') RETURNING id INTO v_fn;
    END IF;
    INSERT INTO erp_mao_obra_custo (company_id,tipo,funcao_id,descricao,setor,vinculo,forma_pagamento,salario,horas_produtivas_mes,quantidade_pessoas,conferido,conferido_em,vigencia_inicio)
    VALUES (v_co,'perfil',v_fn,'Gerente de contrato (perfil DEMO v2)','Gestão','clt','mensal',6500,200,1,true,now(),CURRENT_DATE) RETURNING id INTO v_fid;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,subtipo,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,0,'fixo','mensal',6500,0,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt','fixo','mensal') k;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,descricao,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,1,'comissao','2% sobre medição (base R$120k)',0,120000,2,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt','comissao') k;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,descricao,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,2,'bonus','Bônus por meta de prazo',1500,0,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt','bonus') k;
  END IF;

  ---------------------------------------------------------------------------
  -- 3) Armador de ferragem · CLT intermitente
  ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo WHERE company_id=v_co AND descricao='Armador de ferragem (perfil DEMO v2)') THEN
    SELECT id INTO v_fn FROM erp_funcao_mao_obra WHERE company_id=v_co AND nome='Armador de ferragem' LIMIT 1;
    IF v_fn IS NULL THEN
      INSERT INTO erp_funcao_mao_obra (company_id,nome,cbo,forma_pagamento) VALUES (v_co,'Armador de ferragem','7155-05','mensal') RETURNING id INTO v_fn;
    END IF;
    INSERT INTO erp_mao_obra_custo (company_id,tipo,funcao_id,descricao,setor,vinculo,forma_pagamento,salario,horas_produtivas_mes,quantidade_pessoas,conferido,conferido_em,vigencia_inicio)
    VALUES (v_co,'perfil',v_fn,'Armador de ferragem (perfil DEMO v2)','Estrutura','clt_intermitente','mensal',2600,176,1,true,now(),CURRENT_DATE) RETURNING id INTO v_fid;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,subtipo,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,0,'fixo','mensal',2600,0,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('clt_intermitente','fixo','mensal') k;
  END IF;

  ---------------------------------------------------------------------------
  -- 4) Topógrafo · Autônomo (RPA) — 20% INSS autônomo
  ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo WHERE company_id=v_co AND descricao='Topógrafo (perfil DEMO v2)') THEN
    SELECT id INTO v_fn FROM erp_funcao_mao_obra WHERE company_id=v_co AND nome='Topógrafo' LIMIT 1;
    IF v_fn IS NULL THEN
      INSERT INTO erp_funcao_mao_obra (company_id,nome,cbo,forma_pagamento) VALUES (v_co,'Topógrafo','3123-15','mensal') RETURNING id INTO v_fn;
    END IF;
    INSERT INTO erp_mao_obra_custo (company_id,tipo,funcao_id,descricao,setor,vinculo,forma_pagamento,salario,horas_produtivas_mes,quantidade_pessoas,conferido,conferido_em,vigencia_inicio)
    VALUES (v_co,'perfil',v_fn,'Topógrafo (perfil DEMO v2)','Engenharia','rpa','mensal',5200,160,1,true,now(),CURRENT_DATE) RETURNING id INTO v_fid;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,subtipo,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,0,'fixo','mensal',5200,0,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('rpa','fixo','mensal') k;
  END IF;

  ---------------------------------------------------------------------------
  -- 5) Auxiliar de limpeza de obra · Diarista (gera alerta > 8 dias/mês)
  ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo WHERE company_id=v_co AND descricao='Auxiliar de limpeza de obra (perfil DEMO v2)') THEN
    SELECT id INTO v_fn FROM erp_funcao_mao_obra WHERE company_id=v_co AND nome='Auxiliar de limpeza de obra' LIMIT 1;
    IF v_fn IS NULL THEN
      INSERT INTO erp_funcao_mao_obra (company_id,nome,cbo,forma_pagamento) VALUES (v_co,'Auxiliar de limpeza de obra','5143-20','diaria') RETURNING id INTO v_fn;
    END IF;
    INSERT INTO erp_mao_obra_custo (company_id,tipo,funcao_id,descricao,setor,vinculo,forma_pagamento,valor_unidade,dias_mes,horas_produtivas_mes,quantidade_pessoas,conferido,conferido_em,vigencia_inicio)
    VALUES (v_co,'perfil',v_fn,'Auxiliar de limpeza de obra (perfil DEMO v2)','Apoio','diarista','diaria',180,12,96,1,true,now(),CURRENT_DATE) RETURNING id INTO v_fid;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,descricao,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,0,'diaria','Diária x 12 dias/mês',180,12,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('diarista','diaria') k;
  END IF;

  ---------------------------------------------------------------------------
  -- 6) Contrapiso por empreita · MEI/PJ/empreiteiro (componente empreitada)
  ---------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo WHERE company_id=v_co AND descricao='Contrapiso por empreita (perfil DEMO v2)') THEN
    SELECT id INTO v_fn FROM erp_funcao_mao_obra WHERE company_id=v_co AND nome='Contrapiso por empreita' LIMIT 1;
    IF v_fn IS NULL THEN
      INSERT INTO erp_funcao_mao_obra (company_id,nome,cbo,forma_pagamento,unidade_producao) VALUES (v_co,'Contrapiso por empreita','7155-10','producao','m2') RETURNING id INTO v_fn;
    END IF;
    INSERT INTO erp_mao_obra_custo (company_id,tipo,funcao_id,descricao,setor,vinculo,forma_pagamento,horas_produtivas_mes,quantidade_pessoas,conferido,conferido_em,vigencia_inicio)
    VALUES (v_co,'perfil',v_fn,'Contrapiso por empreita (perfil DEMO v2)','Execução','pj','producao',176,1,true,now(),CURRENT_DATE) RETURNING id INTO v_fid;
    INSERT INTO erp_mao_obra_componente (ficha_id,company_id,ordem,tipo,descricao,valor,quantidade,percentual,gera_dsr,integra_13_ferias,incide_encargos,integra_remuneracao)
      SELECT v_fid,v_co,0,'empreitada','Empreita R$9.000 em 25 dias',9000,25,NULL,(k->>'gera_dsr')::bool,(k->>'integra_13_ferias')::bool,(k->>'incide_encargos')::bool,(k->>'integra_remuneracao')::bool FROM fn_mao_obra_chaves_padrao('pj','empreitada') k;
  END IF;
END $$;
