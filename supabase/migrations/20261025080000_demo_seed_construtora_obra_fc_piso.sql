-- Hub · Construtora DEMO (…0006): obra "cara de FC" — piso industrial uretano/epóxi (caixa 713bb4f3, item 1).
-- 1) fn_demo_seed_construtora_fc(company, etapa) — função NOVA, só na 006 e só se is_demo; sem GRANT a usuário.
--    'limpar': apaga só a tabela de preço FIXA desta semente (…e0002). Obras, orçamentos, tarefas, apontamentos,
--              serviços, clientes DEMO-C% e viagens já são zerados pelo fn_demo_seed_construtora/extras.
--    'semear': cliente fictício Frigorífico Oeste (DEMO-C05), oportunidade ganha, insumos/mão de obra/serviços de piso
--              com composição (BOM), CONTRATO DE PREÇOS do cliente (faixas × regimes × códigos), obra DEMO-FC-001 com
--              itens a preço do contrato, orçamento aprovado, cronograma com dependências e custo previsto por etapa,
--              apontamentos diários por função e a viagem 3 da equipe (fechada, com km, abastecimentos e despesas).
--    Nenhum título é criado no contas a pagar e nada fiscal é gerado (isso é a GE das viagens / HB-C).
-- 2) fn_demo_seed_construtora: patch por âncora (corpo vigente preservado — RD-69; aborta se a âncora sumir).
-- 3) Roda uma vez agora (só se a 006 existir e for demo).
-- RD-55: nenhuma empresa real é tocada. Plano de volta: tirar as 2 linhas PERFORM fn_demo_seed_construtora_fc do
-- fn_demo_seed_construtora (CREATE OR REPLACE pelo corpo vivo) e DROP FUNCTION fn_demo_seed_construtora_fc.

-- ci-sem-guarda: fn_demo_seed_construtora_fc — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_fc(p_company_id uuid, p_etapa text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  tp constant uuid := 'b0700000-0000-4000-a000-0000000e0002';
  te constant uuid := 'b0700000-0000-4000-a000-0000000e0001';
  cat constant text := '2.04.06';
  v_hoje date := current_date;
  v_ini date := current_date - 21;
  v_cli uuid; v_op uuid; v_obra uuid; v_orc uuid; v_via uuid; v_id uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_t5 uuid; v_t6 uuid;
  v_ins uuid[] := '{}'; v_mo uuid[] := '{}'; v_srv uuid[] := '{}';
  v_n_apont int := 0;
  i int;
  -- insumos: código, nome, un, custo
  v_ins_def text[][] := ARRAY[
    ['DEMO-FC-I01','Primer epóxi bicomponente','kg','48.00'],
    ['DEMO-FC-I02','Argamassa de uretano cimentício','kg','7.90'],
    ['DEMO-FC-I03','Resina epóxi autonivelante','kg','24.00'],
    ['DEMO-FC-I04','Areia de quartzo seca','kg','1.90'],
    ['DEMO-FC-I05','Selante PU para junta (600 ml)','un','38.00'],
    ['DEMO-FC-I06','Disco diamantado de fresagem','un','260.00'],
    ['DEMO-FC-I07','Locação de fresadora e aspirador industrial','dia','680.00']];
  v_mo_def text[][] := ARRAY[
    ['Aplicador de piso industrial','DEMO-FC-M01','34.00'],
    ['Ajudante de aplicação','DEMO-FC-M02','21.00'],
    ['Encarregado de obra','DEMO-FC-M03','45.00']];
  -- serviços: código (= referência no contrato), nome, un, categoria
  v_srv_def text[][] := ARRAY[
    ['DEMO-FC-S01','Preparo mecânico do substrato (fresagem e aspiração)','m2','Piso industrial'],
    ['DEMO-FC-S02','Piso de uretano cimentício 6 mm','m2','Piso industrial'],
    ['DEMO-FC-S03','Piso epóxi autonivelante 2 mm','m2','Piso industrial'],
    ['DEMO-FC-S04','Rodapé sanitário em uretano (meia-cana)','ml','Piso industrial'],
    ['DEMO-FC-S05','Junta de dilatação com selante PU','ml','Piso industrial']];
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  IF p_etapa = 'limpar' THEN
    -- medição demo da tabela …e0001 (HB2 #3122) aponta para ela; o 'limpar' do extras apaga a …e0001 e a FK barrava (deploy 2243)
    DELETE FROM erp_medicao_cliente_item WHERE company_id = c AND medicao_id IN (SELECT id FROM erp_medicao_cliente WHERE company_id = c AND tabela_id = te);
    DELETE FROM erp_medicao_cliente WHERE company_id = c AND tabela_id = te;
    DELETE FROM erp_tabela_preco_codigo WHERE tabela_id = tp AND company_id = c;
    DELETE FROM erp_tabela_preco_condicao WHERE tabela_id = tp AND company_id = c;
    DELETE FROM erp_tabela_preco_item WHERE tabela_id = tp AND company_id = c;
    DELETE FROM erp_tabela_preco_cliente WHERE id = tp AND company_id = c;
    RETURN jsonb_build_object('ok', true, 'etapa', 'limpar');
  END IF;

  IF p_etapa IS DISTINCT FROM 'semear' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'etapa_invalida');
  END IF;
  IF EXISTS (SELECT 1 FROM projetos_obras WHERE company_id = c AND numero = 'DEMO-FC-001') THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora_fc: DEMO-FC-001 já existe (rode pelo fn_demo_seed_construtora)';
  END IF;

  -- cliente fictício (cadastro completo, como os demais DEMO-C0x)
  INSERT INTO erp_clientes (company_id, codigo, nome_fantasia, razao_social, tipo_pessoa, cidade, uf, ativo,
                            cpf_cnpj, cnpj_cpf, telefone, celular, email, cep, logradouro, numero, bairro, origem, segmento)
  SELECT c, 'DEMO-C05', 'Frigorífico Oeste (Demo)', 'Frigorífico Oeste Alimentos LTDA (fictício)', 'J', 'Concórdia', 'SC', true,
         d.doc, d.doc, '(49) 3442-4105', '(49) 99905-4105', 'engenharia@frigorificooeste.exemplo.com.br',
         '89700-100', 'Rodovia SC-283, km 12', 's/n', 'Distrito Industrial', 'indicacao', 'Indústria de alimentos'
    FROM (SELECT regexp_replace(fn_demo_cnpj_valido(612040980001::bigint), '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5') AS doc) d
  RETURNING id INTO v_cli;

  -- insumos, mão de obra e serviços de piso industrial
  FOR i IN 1..array_length(v_ins_def, 1) LOOP
    INSERT INTO m16_insumos (company_id, erp_code, name, unit, category, current_cost, last_cost, status, source_type)
    VALUES (c, v_ins_def[i][1], v_ins_def[i][2], v_ins_def[i][3], 'Piso industrial', v_ins_def[i][4]::numeric,
            v_ins_def[i][4]::numeric, 'ativo', 'demo')
    RETURNING id INTO v_id;
    v_ins := v_ins || v_id;
  END LOOP;
  FOR i IN 1..array_length(v_mo_def, 1) LOOP
    INSERT INTO projetos_mao_obra (company_id, funcao, codigo, custo_hora, encargos_pct, tipo_contratacao, ativo)
    VALUES (c, v_mo_def[i][1], v_mo_def[i][2], v_mo_def[i][3]::numeric, 72, 'clt', true)
    RETURNING id INTO v_id;
    v_mo := v_mo || v_id;
  END LOOP;
  FOR i IN 1..array_length(v_srv_def, 1) LOOP
    INSERT INTO projetos_servicos (company_id, codigo, nome, unidade, categoria, produtividade_unidade_dia, ativo, source_type)
    VALUES (c, v_srv_def[i][1], v_srv_def[i][2], v_srv_def[i][3], v_srv_def[i][4],
            (ARRAY[260, 90, 120, 60, 90])[i], true, 'demo')
    RETURNING id INTO v_id;
    v_srv := v_srv || v_id;
  END LOOP;

  -- composição por unidade (serviço, tipo, índice do insumo/mão de obra, quantidade); mão de obra a custo com encargos
  INSERT INTO projetos_servicos_bom (servico_id, tipo, insumo_id, mao_obra_id, quantidade, unidade, custo_unitario, custo_total, perda_pct, ordem)
  SELECT v_srv[b.s], b.t, CASE WHEN b.t = 'insumo' THEN v_ins[b.k] END, CASE WHEN b.t = 'mao_obra' THEN v_mo[b.k] END,
         b.q, CASE WHEN b.t = 'insumo' THEN v_ins_def[b.k][3] ELSE 'h' END,
         CASE WHEN b.t = 'insumo' THEN v_ins_def[b.k][4]::numeric ELSE v_mo_def[b.k][3]::numeric * 1.72 END,
         b.q * CASE WHEN b.t = 'insumo' THEN v_ins_def[b.k][4]::numeric ELSE v_mo_def[b.k][3]::numeric * 1.72 END,
         CASE WHEN b.t = 'insumo' THEN 5 ELSE 0 END, b.o
    FROM (VALUES
      (1,'insumo',6,0.004,1),(1,'insumo',7,0.004,2),(1,'mao_obra',1,0.10,3),(1,'mao_obra',2,0.15,4),
      (2,'insumo',1,0.30,1),(2,'insumo',2,12.0,2),(2,'insumo',4,1.50,3),(2,'mao_obra',1,0.35,4),(2,'mao_obra',2,0.35,5),
      (3,'insumo',1,0.30,1),(3,'insumo',3,3.20,2),(3,'insumo',4,0.80,3),(3,'mao_obra',1,0.25,4),(3,'mao_obra',2,0.25,5),
      (4,'insumo',2,2.50,1),(4,'insumo',1,0.08,2),(4,'mao_obra',1,0.40,3),(4,'mao_obra',2,0.20,4),
      (5,'insumo',5,0.25,1),(5,'mao_obra',1,0.15,2)
    ) AS b(s, t, k, q, o);
  UPDATE projetos_servicos s SET
    custo_material = COALESCE((SELECT sum(custo_total) FROM projetos_servicos_bom WHERE servico_id = s.id AND tipo = 'insumo'), 0),
    custo_mao_obra = COALESCE((SELECT sum(custo_total) FROM projetos_servicos_bom WHERE servico_id = s.id AND tipo = 'mao_obra'), 0),
    custo_unitario_total = COALESCE((SELECT sum(custo_total) FROM projetos_servicos_bom WHERE servico_id = s.id), 0)
   WHERE s.id = ANY (v_srv);

  -- contrato de preços do cliente: faixas por quantidade × regimes (adicional %) × código no ERP do cliente
  INSERT INTO erp_tabela_preco_cliente (id, company_id, cliente_id, nome, vigencia_inicio, vigencia_fim, moeda, ativo)
  VALUES (tp, c, v_cli, 'Contrato de preços 2026 – Frigorífico Oeste (Demo)', date_trunc('year', v_hoje)::date,
          (date_trunc('year', v_hoje) + interval '1 year - 1 day')::date, 'BRL', true);
  INSERT INTO erp_tabela_preco_item (company_id, tabela_id, servico_ref, servico_nome, unidade, faixa_de, faixa_ate, preco_base, adicional)
  SELECT c, tp, v_srv_def[f.s][1], v_srv_def[f.s][2], v_srv_def[f.s][3], f.de, f.ate, f.preco, false
    FROM (VALUES
      (1, 0::numeric, 500::numeric, 24.00::numeric), (1, 500, 2000, 21.50), (1, 2000, NULL, 19.00),
      (2, 0, 500, 245.00), (2, 500, 2000, 228.00), (2, 2000, NULL, 214.00),
      (3, 0, 500, 168.00), (3, 500, 2000, 156.00), (3, 2000, NULL, 145.00),
      (4, 0, 200, 96.00), (4, 200, NULL, 88.00),
      (5, 0, 200, 26.00), (5, 200, NULL, 23.50)
    ) AS f(s, de, ate, preco);
  INSERT INTO erp_tabela_preco_condicao (company_id, tabela_id, condicao, percentual)
  VALUES (c, tp, 'normal', NULL), (c, tp, 'noturno', 25), (c, tp, 'sabado', 50), (c, tp, 'domingo_feriado', 100);
  INSERT INTO erp_tabela_preco_codigo (company_id, tabela_id, servico_ref, condicao, codigo_externo, preco_fixo)
  SELECT c, tp, v_srv_def[s.n][1], r.cond, 'FO-' || (1000 + s.n * 100 + r.k)::text, NULL
    FROM generate_series(1, 5) AS s(n)
   CROSS JOIN (VALUES ('normal', 1), ('noturno', 2), ('sabado', 3), ('domingo_feriado', 4)) AS r(cond, k);

  -- oportunidade ganha → obra
  INSERT INTO erp_crm_oportunidade (company_id, cliente_id, titulo, etapa, valor_estimado, valor_proposta, probabilidade,
                                    origem, obra_cidade, data_prevista_fechamento, data_fechamento, responsavel_nome)
  VALUES (c, v_cli, 'Piso industrial – Frigorífico Oeste', 'ganho', 480000, NULL, 100, 'indicacao', 'Concórdia',
          v_ini - 10, v_ini - 10, 'Responsável Demo')
  RETURNING id INTO v_op;
  INSERT INTO projetos_obras (company_id, numero, oportunidade_id, nome, cliente_id, cliente_nome, endereco, cidade, uf, status,
                              responsavel_nome, valor_previsto, valor_medido, custo_realizado, pct_conclusao,
                              data_inicio, data_prevista_fim, observacoes)
  VALUES (c, 'DEMO-FC-001', v_op, 'Piso industrial – câmara fria e expedição · Frigorífico Oeste', v_cli, 'Frigorífico Oeste (Demo)',
          'Rodovia SC-283, km 12 – Distrito Industrial', 'Concórdia', 'SC', 'em_andamento', 'Responsável Demo', 0, 0, 0, 0,
          v_ini, v_ini + 45, 'Uretano 6 mm na câmara fria (1.100 m²) e epóxi autonivelante na expedição (750 m²). Trabalho em parada programada do cliente.')
  RETURNING id INTO v_obra;

  -- itens da obra a preço do CONTRATO (faixa pela quantidade, regime normal); custo previsto = composição do serviço
  INSERT INTO projetos_obra_item (company_id, obra_id, servico_id, ordem, descricao, unidade, quantidade_contratada,
                                  preco_unitario, custo_unitario_previsto, bdi_percentual, quantidade_medida)
  SELECT c, v_obra, s.id, q.ordem, s.nome || q.local, s.unidade, q.qtd, ti.preco_base, s.custo_unitario_total,
         round((ti.preco_base / NULLIF(s.custo_unitario_total, 0) - 1) * 100, 2), q.medida
    FROM (VALUES (1, 1, 1850::numeric, 1850::numeric, ' – área total'), (2, 2, 1100, 660, ' – câmara fria'),
                 (3, 3, 750, 300, ' – expedição'), (4, 4, 420, 168, ''), (5, 5, 380, 0, '')) AS q(ordem, srv, qtd, medida, local)
    JOIN projetos_servicos s ON s.id = v_srv[q.srv]
    JOIN erp_tabela_preco_item ti ON ti.tabela_id = tp AND ti.servico_ref = s.codigo
     AND q.qtd >= ti.faixa_de AND (ti.faixa_ate IS NULL OR q.qtd < ti.faixa_ate);

  -- orçamento aprovado (rascunho → itens → aprovado; a obra já aponta para ele, então o gatilho não cria outra)
  INSERT INTO erp_orcamentos (company_id, numero, cliente_id, cliente_nome, data_emissao, data_validade, status,
                              eh_obra, obra_id, obra_cidade, obra_uf, vendedor_nome, condicao_pagamento, observacoes)
  VALUES (c, 'DEMO-ORC-FC1', v_cli, 'Frigorífico Oeste (Demo)', v_ini - 25, v_ini + 5, 'rascunho', true, v_obra,
          'Concórdia', 'SC', 'Responsável Demo', 'Medição quinzenal pelo contrato de preços', 'Piso industrial – câmara fria e expedição')
  RETURNING id INTO v_orc;
  UPDATE projetos_obras SET orcamento_id = v_orc WHERE id = v_obra;
  INSERT INTO erp_orcamentos_itens (orcamento_id, company_id, ordem, tipo_item, servico_id, servico_codigo, servico_descricao,
                                    produto_nome, unidade, quantidade, preco_unitario, preco_custo, subtotal,
                                    bdi_percentual, margem_percentual)
  SELECT v_orc, c, i.ordem, 'servico', s.id, s.codigo, i.descricao, i.descricao, i.unidade, i.quantidade_contratada,
         i.preco_unitario, i.custo_unitario_previsto, round(i.quantidade_contratada * i.preco_unitario, 2),
         i.bdi_percentual,
         CASE WHEN i.preco_unitario > 0 THEN round((i.preco_unitario - i.custo_unitario_previsto) / i.preco_unitario * 100, 2) END
    FROM projetos_obra_item i JOIN projetos_servicos s ON s.id = i.servico_id
   WHERE i.obra_id = v_obra ORDER BY i.ordem;
  UPDATE projetos_obra_item i SET orcamento_item_id = oi.id
    FROM erp_orcamentos_itens oi WHERE oi.orcamento_id = v_orc AND oi.servico_id = i.servico_id AND oi.ordem = i.ordem
     AND i.obra_id = v_obra;
  UPDATE erp_orcamentos SET status = 'aprovado', data_aprovacao = (v_ini - 12)::timestamptz WHERE id = v_orc;
  UPDATE erp_crm_oportunidade o SET orcamento_id = v_orc, valor_proposta = r.total
    FROM erp_orcamentos r WHERE r.id = v_orc AND o.id = v_op;

  -- cronograma: etapas do piso, linha de base, dependências e custo previsto por etapa (= itens da etapa)
  INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
  VALUES (c, v_obra, 'Mobilização e isolamento da área', v_ini, v_ini + 2, 100, 1, v_ini, v_ini + 2) RETURNING id INTO v_t1;
  INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
  VALUES (c, v_obra, 'Preparo mecânico do substrato', v_ini + 3, v_ini + 9, 100, 2, v_ini + 3, v_ini + 8) RETURNING id INTO v_t2;
  INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
  VALUES (c, v_obra, 'Uretano 6 mm – câmara fria', v_ini + 10, v_ini + 28, 60, 3, v_ini + 9, v_ini + 26) RETURNING id INTO v_t3;
  INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
  VALUES (c, v_obra, 'Epóxi autonivelante – expedição', v_ini + 17, v_ini + 34, 40, 4, v_ini + 16, v_ini + 32) RETURNING id INTO v_t4;
  INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
  VALUES (c, v_obra, 'Rodapé sanitário e juntas', v_ini + 29, v_ini + 42, 25, 5, v_ini + 27, v_ini + 40) RETURNING id INTO v_t5;
  INSERT INTO projetos_obra_tarefa (company_id, obra_id, nome, inicio, fim, percentual, ordem, inicio_base, fim_base)
  VALUES (c, v_obra, 'Cura, liberação e entrega', v_ini + 43, v_ini + 45, 0, 6, v_ini + 41, v_ini + 43) RETURNING id INTO v_t6;
  UPDATE projetos_obra_tarefa t SET custo_previsto = x.custo
    FROM (SELECT CASE i.ordem WHEN 1 THEN v_t2 WHEN 2 THEN v_t3 WHEN 3 THEN v_t4 ELSE v_t5 END AS tarefa_id,
                 round(sum(i.quantidade_contratada * i.custo_unitario_previsto), 2) AS custo
            FROM projetos_obra_item i WHERE i.obra_id = v_obra GROUP BY 1) x
   WHERE t.id = x.tarefa_id;
  INSERT INTO projetos_obra_tarefa_dependencia (company_id, tarefa_id, predecessora_id, defasagem_dias)
  VALUES (c, v_t2, v_t1, 0), (c, v_t3, v_t2, 0), (c, v_t4, v_t2, 7), (c, v_t5, v_t3, 0), (c, v_t6, v_t4, 0), (c, v_t6, v_t5, 0);

  -- apontamentos: de segunda a sábado desde o início; 3 aplicadores, 2 ajudantes e o encarregado (custo com encargos)
  INSERT INTO projetos_obra_mao_obra_apontamento (company_id, obra_id, data, funcao_id, descricao, horas, custo_hora)
  SELECT c, v_obra, d::date, m.funcao_id,
         m.funcao || ' — ' || CASE WHEN d::date < v_ini + 3 THEN 'mobilização e isolamento'
                                   WHEN d::date < v_ini + 10 THEN 'fresagem e aspiração do substrato'
                                   WHEN d::date < v_ini + 17 THEN 'uretano na câmara fria'
                                   ELSE 'uretano na câmara fria e epóxi na expedição' END,
         (ARRAY[24, 16, 8])[k.n], round(m.custo_hora * (1 + COALESCE(m.encargos_pct, 0) / 100.0), 2)
    FROM generate_series(v_ini, v_hoje - 1, interval '1 day') AS d
   CROSS JOIN generate_series(1, 3) AS k(n)
    JOIN projetos_mao_obra m ON m.id = v_mo[k.n]
   WHERE extract(isodow FROM d) < 7;
  GET DIAGNOSTICS v_n_apont = ROW_COUNT;

  -- números da obra (mesmas fórmulas do fn_demo_seed_construtora)
  UPDATE projetos_obras o SET
    valor_previsto = COALESCE((SELECT round(sum(i.quantidade_contratada * i.preco_unitario), 2)
                                 FROM projetos_obra_item i WHERE i.obra_id = o.id AND i.excluido_em IS NULL), 0),
    custo_realizado = COALESCE((SELECT round(sum(i.quantidade_medida * s.custo_material), 2)
                                  FROM projetos_obra_item i JOIN projetos_servicos s ON s.id = i.servico_id
                                 WHERE i.obra_id = o.id AND i.excluido_em IS NULL), 0)
                    + COALESCE((SELECT sum(a.valor) FROM projetos_obra_mao_obra_apontamento a
                                 WHERE a.obra_id = o.id AND a.excluido_em IS NULL), 0)
   WHERE o.id = v_obra;
  PERFORM fn_obra_recalcular_medido(v_obra);
  UPDATE projetos_obras SET pct_conclusao = LEAST(100, round(valor_medido / NULLIF(valor_previsto, 0) * 100))::int
   WHERE id = v_obra;

  -- viagem 3 da equipe de aplicação (fechada): prestação de contas com km, abastecimentos e despesas
  INSERT INTO erp_viagem (company_id, numero, colaborador_nome, placa, obra_id, periodo_inicio, periodo_fim, origem, destino,
                          km_inicial, km_final, adiantamento, status, origem_registro, observacao, fechada_em)
  VALUES (c, 3, 'Rafael Encarregado (Demo)', 'DEM3C03', v_obra, v_hoje - 14, v_hoje - 10, 'Chapecó', 'Concórdia',
          61200, 61520, 1500, 'aberta', 'administrativo', 'Equipe de aplicação (3 pessoas) – uretano na câmara fria', NULL)
  RETURNING id INTO v_via;
  INSERT INTO erp_viagem_lancamento (company_id, viagem_id, tipo, data, fornecedor_nome, documento, tipo_despesa, categoria,
                                     descricao, forma_pagamento, pago_colaborador, valor, obra_id, placa, hodometro, litros,
                                     tanque_cheio, origem_registro)
  VALUES
    (c, v_via, 'abastecimento', v_hoje - 14, 'Posto Rodovia (Demo)', 'NFC-e 70114', 'combustivel', cat, 'Diesel S10 – saída',
     'cartao_empresa', false, 327.08, v_obra, 'DEM3C03', 61200, 52.0, true, 'administrativo'),
    (c, v_via, 'despesa', v_hoje - 14, 'Hotel Concórdia Center (Demo)', 'NF 5521', 'hospedagem', cat, '4 diárias – 3 pessoas',
     'cartao_empresa', false, 1380.00, v_obra, NULL, NULL, NULL, NULL, 'administrativo'),
    (c, v_via, 'despesa', v_hoje - 12, 'Restaurante Colonial (Demo)', 'NFC-e 31877', 'alimentacao', cat, 'Almoço e jantar – 3 pessoas',
     'cartao_proprio', true, 486.50, v_obra, NULL, NULL, NULL, NULL, 'campo'),
    (c, v_via, 'despesa', v_hoje - 10, 'Pedágio SC-283 (Demo)', NULL, 'pedagio', cat, 'Volta',
     'dinheiro', true, 24.60, v_obra, NULL, NULL, NULL, NULL, 'campo'),
    (c, v_via, 'abastecimento', v_hoje - 10, 'Posto Trevo (Demo)', 'NFC-e 55790', 'combustivel', cat, 'Diesel S10 – retorno',
     'dinheiro', true, 242.17, v_obra, 'DEM3C03', 61490, 38.5, true, 'campo');
  UPDATE erp_viagem SET status = 'fechada', fechada_em = (v_hoje - 9)::timestamptz, atualizado_em = now() WHERE id = v_via;
  INSERT INTO erp_viagem_evento (company_id, viagem_id, tipo, payload)
  SELECT c, v_via, 'viagem_fechada', jsonb_build_object(
    'numero', 3, 'colaborador', v.colaborador_nome, 'resumo', fn_viagem_resumo(v_via),
    'lancamentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'fornecedor', l.fornecedor_nome,
        'categoria', l.categoria, 'valor', l.valor, 'obra_id', l.obra_id, 'forma_pagamento', l.forma_pagamento,
        'pago_colaborador', l.pago_colaborador) ORDER BY l.data)
      FROM erp_viagem_lancamento l WHERE l.viagem_id = v_via AND l.excluido_em IS NULL), '[]'::jsonb))
    FROM erp_viagem v WHERE v.id = v_via;

  RETURN jsonb_build_object('ok', true, 'etapa', 'semear', 'obra', 'DEMO-FC-001',
    'valor_previsto', (SELECT valor_previsto FROM projetos_obras WHERE id = v_obra),
    'valor_medido', (SELECT valor_medido FROM projetos_obras WHERE id = v_obra),
    'custo_realizado', (SELECT custo_realizado FROM projetos_obras WHERE id = v_obra),
    'apontamentos', v_n_apont,
    'tarefas', (SELECT count(*) FROM projetos_obra_tarefa WHERE obra_id = v_obra),
    'viagem_total', (SELECT sum(valor) FROM erp_viagem_lancamento WHERE viagem_id = v_via),
    'contrato_faixas', (SELECT count(*) FROM erp_tabela_preco_item WHERE tabela_id = tp),
    'contrato_codigos', (SELECT count(*) FROM erp_tabela_preco_codigo WHERE tabela_id = tp));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_fc(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_fc(uuid, text) TO service_role;

-- a semente principal passa a limpar/semear a obra FC (patch por âncora, corpo vigente — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_fc' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_extras(c, ''limpar'');',
    E'  PERFORM fn_demo_seed_construtora_fc(c, ''limpar'');\n  PERFORM fn_demo_seed_construtora_extras(c, ''limpar'');');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da limpeza (extras limpar) nao encontrada'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'  PERFORM fn_demo_seed_construtora_extras(c, ''semear'');',
    E'  PERFORM fn_demo_seed_construtora_extras(c, ''semear'');\n  PERFORM fn_demo_seed_construtora_fc(c, ''semear'');');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da semeadura (extras semear) nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

-- aplica agora (só se a demo existir neste banco)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;

-- refaz a medição demo de exemplo (HB2) que o 'limpar' acima removeu — mesmo bloco idempotente da 20261025060054
DO $$
DECLARE v_tab uuid := 'b0700000-0000-4000-a000-0000000e0001'; v_co uuid := 'b0700000-0000-4000-a000-000000000006';
  v_med uuid := 'b0700000-0000-4000-a000-0000000e0f01'; v_tot numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_tabela_preco_cliente WHERE id = v_tab AND company_id = v_co) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM erp_medicao_cliente WHERE id = v_med) THEN RETURN; END IF;
  INSERT INTO erp_medicao_cliente (id, company_id, tabela_id, descricao, periodo_inicio, periodo_fim, total)
  VALUES (v_med, v_co, v_tab, 'Medição setembro/2026 (exemplo)', '2026-09-01', '2026-09-30', 0);
  INSERT INTO erp_medicao_cliente_item (company_id, medicao_id, servico_ref, unidade, quantidade, condicao, faixa_de, faixa_ate, preco_unitario, total, codigo_externo)
  SELECT v_co, v_med, q.ref, i.unidade, q.qtd, q.cond, i.faixa_de, i.faixa_ate,
         round(COALESCE(k.preco_fixo, i.preco_base * (1 + COALESCE(c.percentual, 0) / 100)), 2),
         round(q.qtd * round(COALESCE(k.preco_fixo, i.preco_base * (1 + COALESCE(c.percentual, 0) / 100)), 2), 2),
         k.codigo_externo
    FROM (VALUES ('DEMO-S01', 250::numeric, 'normal'), ('DEMO-S02', 120::numeric, 'normal'), ('DEMO-S01', 80::numeric, 'sabado')) q(ref, qtd, cond)
    JOIN erp_tabela_preco_item i ON i.tabela_id = v_tab AND i.servico_ref = q.ref AND q.qtd >= i.faixa_de AND (i.faixa_ate IS NULL OR q.qtd < i.faixa_ate)
    LEFT JOIN erp_tabela_preco_condicao c ON c.tabela_id = v_tab AND c.condicao = q.cond AND q.cond <> 'normal'
    LEFT JOIN erp_tabela_preco_codigo k ON k.tabela_id = v_tab AND k.servico_ref = q.ref AND k.condicao = q.cond;
  SELECT COALESCE(sum(total), 0) INTO v_tot FROM erp_medicao_cliente_item WHERE medicao_id = v_med;
  UPDATE erp_medicao_cliente SET total = v_tot WHERE id = v_med;
END $$;
