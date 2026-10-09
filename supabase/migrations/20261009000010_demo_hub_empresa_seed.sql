-- Hub · seed da DEMO (CEO 08/10, auditoria run 476). A empresa "Construtora Modelo - DEMO" (b0700000-…-0006), os planos, o
-- acesso e o demo_por_area já vieram na #2265 (20261008180010); esta migration SÓ cria a função de seed.
-- NÃO é executada na migration: ela zera o Hub da demo, e o CEO está preenchendo essa empresa pela tela.
-- Rodar sob demanda (service_role): SELECT fn_gold_hub_seed_reparar('b0700000-0000-4000-a000-000000000006');
--
-- fn_gold_hub_seed_reparar(company): seed determinístico e AUTO-RESETÁVEL (padrão fn_gold_sst_seed_reparar). Só age na
-- empresa 006 e só se is_demo. Dados anônimos, no formato de Tryo/FC/R.R:
--  • 10 insumos (m16_insumos, custo), 4 funções de mão de obra, 4 serviços de catálogo com BOM (insumo + mão de obra);
--  • 4 clientes fictícios; 5 oportunidades (2 ganhas que viraram obra, 1 em proposta, 1 em negociação, 1 prospecção);
--  • 4 obras (3 em andamento, 1 concluída) com itens contratados, medição e % de conclusão.
-- Compras, viagens e medições fiscais ficam para a próxima fatia (tabelas dependem de estoque/NFS-e da demo).

-- ci-sem-guarda: fn_gold_hub_seed_reparar — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
CREATE OR REPLACE FUNCTION public.fn_gold_hub_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_hoje date := current_date;
  i int; j int;
  v_ins uuid[] := '{}'; v_mo uuid[] := '{}'; v_srv uuid[] := '{}'; v_cli uuid[] := '{}'; v_op uuid[] := '{}';
  v_id uuid; v_obra uuid;
  -- insumos: código, nome, un, custo
  v_ins_def text[][] := ARRAY[
    ['DEMO-I01','Placa de gesso acartonado ST 1,20x1,80','un','38.50'],
    ['DEMO-I02','Perfil montante 48mm','br','14.90'],
    ['DEMO-I03','Perfil guia 48mm','br','12.40'],
    ['DEMO-I04','Parafuso GN25 (cento)','cto','9.80'],
    ['DEMO-I05','Massa para junta (balde 5kg)','bd','27.00'],
    ['DEMO-I06','Fita telada','rl','6.50'],
    ['DEMO-I07','Piso porcelanato 60x60','m2','54.00'],
    ['DEMO-I08','Argamassa ACIII 20kg','sc','31.00'],
    ['DEMO-I09','Rejunte 1kg','kg','11.50'],
    ['DEMO-I10','Tinta acrílica premium 18L','lt','289.00']];
  v_mo_def text[][] := ARRAY[
    ['Gesseiro','DEMO-M01','32.00'],['Pedreiro','DEMO-M02','28.00'],
    ['Pintor','DEMO-M03','26.00'],['Servente','DEMO-M04','18.00']];
  -- serviços: código, nome, un, categoria
  v_srv_def text[][] := ARRAY[
    ['DEMO-S01','Forro de gesso acartonado','m2','Gesso'],
    ['DEMO-S02','Parede drywall simples','m2','Gesso'],
    ['DEMO-S03','Assentamento de porcelanato 60x60','m2','Revestimento'],
    ['DEMO-S04','Pintura acrílica 2 demãos','m2','Pintura']];
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- zera o Hub da demo (ordem das FKs)
  DELETE FROM projetos_obra_item WHERE company_id = c;
  DELETE FROM projetos_obras WHERE company_id = c;
  DELETE FROM erp_crm_oportunidade WHERE company_id = c;
  DELETE FROM projetos_servicos_bom WHERE servico_id IN (SELECT id FROM projetos_servicos WHERE company_id = c);
  DELETE FROM projetos_servicos WHERE company_id = c;
  DELETE FROM projetos_mao_obra WHERE company_id = c;
  DELETE FROM m16_insumos WHERE company_id = c;
  DELETE FROM erp_clientes WHERE company_id = c AND codigo LIKE 'DEMO-C%';

  FOR i IN 1..array_length(v_ins_def,1) LOOP
    INSERT INTO m16_insumos (company_id, erp_code, name, unit, category, current_cost, last_cost, status, source_type)
    VALUES (c, v_ins_def[i][1], v_ins_def[i][2], v_ins_def[i][3], 'Materiais', v_ins_def[i][4]::numeric, v_ins_def[i][4]::numeric, 'ativo', 'demo')
    RETURNING id INTO v_id;
    v_ins := v_ins || v_id;
  END LOOP;

  FOR i IN 1..array_length(v_mo_def,1) LOOP
    INSERT INTO projetos_mao_obra (company_id, funcao, codigo, custo_hora, encargos_pct, tipo_contratacao, ativo)
    VALUES (c, v_mo_def[i][1], v_mo_def[i][2], v_mo_def[i][3]::numeric, 72, 'clt', true)
    RETURNING id INTO v_id;
    v_mo := v_mo || v_id;
  END LOOP;

  FOR i IN 1..array_length(v_srv_def,1) LOOP
    INSERT INTO projetos_servicos (company_id, codigo, nome, unidade, categoria, produtividade_unidade_dia, ativo, source_type)
    VALUES (c, v_srv_def[i][1], v_srv_def[i][2], v_srv_def[i][3], v_srv_def[i][4], 12, true, 'demo')
    RETURNING id INTO v_id;
    v_srv := v_srv || v_id;
  END LOOP;

  -- BOM: (serviço, tipo, índice do insumo/mão de obra, quantidade)
  INSERT INTO projetos_servicos_bom (servico_id, tipo, insumo_id, mao_obra_id, quantidade, unidade, custo_unitario, custo_total, perda_pct, ordem)
  SELECT v_srv[b.s], b.t, CASE WHEN b.t='insumo' THEN v_ins[b.k] END, CASE WHEN b.t='mao_obra' THEN v_mo[b.k] END,
         b.q, CASE WHEN b.t='insumo' THEN v_ins_def[b.k][3] ELSE 'h' END,
         CASE WHEN b.t='insumo' THEN v_ins_def[b.k][4]::numeric ELSE v_mo_def[b.k][3]::numeric * 1.72 END,
         b.q * CASE WHEN b.t='insumo' THEN v_ins_def[b.k][4]::numeric ELSE v_mo_def[b.k][3]::numeric * 1.72 END,
         CASE WHEN b.t='insumo' THEN 5 ELSE 0 END, b.o
  FROM (VALUES
    (1,'insumo',1,0.31,1),(1,'insumo',3,0.55,2),(1,'insumo',4,0.02,3),(1,'insumo',5,0.15,4),(1,'insumo',6,0.10,5),
    (1,'mao_obra',1,0.60,6),(1,'mao_obra',4,0.30,7),
    (2,'insumo',1,0.62,1),(2,'insumo',2,0.80,2),(2,'insumo',3,0.40,3),(2,'insumo',4,0.04,4),
    (2,'mao_obra',1,0.80,5),(2,'mao_obra',4,0.40,6),
    (3,'insumo',7,1.05,1),(3,'insumo',8,0.20,2),(3,'insumo',9,0.30,3),
    (3,'mao_obra',2,0.70,4),(3,'mao_obra',4,0.35,5),
    (4,'insumo',10,0.06,1),(4,'mao_obra',3,0.45,2),(4,'mao_obra',4,0.10,3)
  ) AS b(s,t,k,q,o);

  UPDATE projetos_servicos s SET
    custo_material = COALESCE((SELECT sum(custo_total) FROM projetos_servicos_bom WHERE servico_id=s.id AND tipo='insumo'),0),
    custo_mao_obra = COALESCE((SELECT sum(custo_total) FROM projetos_servicos_bom WHERE servico_id=s.id AND tipo='mao_obra'),0),
    custo_unitario_total = COALESCE((SELECT sum(custo_total) FROM projetos_servicos_bom WHERE servico_id=s.id),0)
  WHERE s.company_id = c;

  -- clientes fictícios
  FOR i IN 1..4 LOOP
    INSERT INTO erp_clientes (company_id, codigo, nome_fantasia, razao_social, tipo_pessoa, cidade, uf, ativo)
    VALUES (c, 'DEMO-C0'||i,
      (ARRAY['Residencial Vista Verde','Clínica Bem Viver','Mercado Central Demo','Escritório Horizonte'])[i],
      (ARRAY['Vista Verde Empreendimentos LTDA','Clínica Bem Viver S/S','Mercado Central Demo LTDA','Horizonte Advocacia'])[i],
      'J', (ARRAY['Chapecó','Xanxerê','Concórdia','Chapecó'])[i], 'SC', true)
    RETURNING id INTO v_id;
    v_cli := v_cli || v_id;
  END LOOP;

  -- oportunidades: título, etapa, valor, cliente (índice)
  FOR i IN 1..5 LOOP
    INSERT INTO erp_crm_oportunidade (company_id, cliente_id, titulo, etapa, valor_estimado, valor_proposta, probabilidade,
                                      origem, obra_cidade, data_prevista_fechamento, data_fechamento, responsavel_nome)
    VALUES (c, v_cli[LEAST(i,4)],
      (ARRAY['Forro e divisórias – Residencial Vista Verde','Piso e pintura – Clínica Bem Viver','Reforma loja – Mercado Central',
             'Drywall sala comercial – Horizonte','Acabamento fachada – Vista Verde fase 2'])[i],
      (ARRAY['ganho','ganho','proposta_enviada','negociacao','prospeccao'])[i],
      (ARRAY[84000,126000,58000,41000,95000])[i], (ARRAY[84000,126000,58000,NULL,NULL])[i],
      (ARRAY[100,100,60,40,15])[i], 'indicacao', 'Chapecó',
      v_hoje + (i*9), CASE WHEN i<=2 THEN v_hoje - (i*20) END, 'Responsável Demo')
    RETURNING id INTO v_id;
    v_op := v_op || v_id;
  END LOOP;

  -- obras: 2 vindas das oportunidades ganhas + 2 avulsas
  FOR i IN 1..4 LOOP
    INSERT INTO projetos_obras (company_id, numero, oportunidade_id, nome, cliente_id, cliente_nome, cidade, uf, status,
                                responsavel_nome, valor_previsto, valor_medido, custo_realizado, pct_conclusao,
                                data_inicio, data_prevista_fim, data_conclusao)
    VALUES (c, 'DEMO-OB-00'||i, CASE WHEN i<=2 THEN v_op[i] END,
      (ARRAY['Forro e divisórias – Vista Verde','Piso e pintura – Clínica Bem Viver','Reforma loja – Mercado Central','Sala comercial – Horizonte'])[i],
      v_cli[i], (ARRAY['Residencial Vista Verde','Clínica Bem Viver','Mercado Central Demo','Escritório Horizonte'])[i],
      'Chapecó', 'SC', CASE WHEN i=4 THEN 'concluida' ELSE 'em_andamento' END, 'Responsável Demo',
      (ARRAY[84000,126000,58000,41000])[i], (ARRAY[42000,50400,17400,41000])[i], (ARRAY[27300,38900,11200,29500])[i],
      (ARRAY[50,40,30,100])[i], v_hoje - (ARRAY[45,60,20,120])[i], v_hoje + (ARRAY[40,60,50,-15])[i],
      CASE WHEN i=4 THEN v_hoje - 15 END)
    RETURNING id INTO v_obra;
    FOR j IN 1..2 LOOP
      INSERT INTO projetos_obra_item (company_id, obra_id, servico_id, ordem, descricao, unidade, quantidade_contratada,
                                      preco_unitario, custo_unitario_previsto, bdi_percentual, valor_contratado, quantidade_medida)
      SELECT c, v_obra, s.id, j, s.nome, s.unidade, q.qtd, round(s.custo_unitario_total*1.35,2), s.custo_unitario_total, 20,
             round(q.qtd*s.custo_unitario_total*1.35,2), round(q.qtd * (ARRAY[50,40,30,100])[i] / 100.0, 2)
      FROM projetos_servicos s, (SELECT (100 + i*40 + j*25)::numeric qtd) q
      WHERE s.id = v_srv[((i+j-2) % 4) + 1];
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'insumos', array_length(v_ins,1), 'servicos', array_length(v_srv,1),
                            'oportunidades', array_length(v_op,1), 'obras', 4);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_gold_hub_seed_reparar(uuid) FROM PUBLIC, anon, authenticated;
