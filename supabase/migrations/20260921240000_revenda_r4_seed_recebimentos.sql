-- Revenda R4 · Correção do seed: recebimentos da Demo pelo CAMINHO OFICIAL (evento p/ GE)
--
-- REGRESSÃO (RD-38, achada pelo Eng. Chefe): fn_gold_revenda_seed_reparar (o alvo do fn_demo_reset)
-- APAGA veic_venda e seus filhos (inclui veic_venda_recebimento) e recria tudo — MENOS os recebimentos,
-- que vinham de um seed separado (#1603, fn_demo_seed_revenda_r05, por INSERT direto sem erp_receber).
-- Resultado: cada fn_demo_reset zerava recebimentos e erp_receber da demo — viola a RD-69 (seed único e
-- COMPLETO por vertical). A tela de vendas e o acerto ficavam sem "cliente deve / banco deve".
--
-- CORREÇÃO:
-- 1) fn_gold_revenda_seed_reparar passa a recriar os recebimentos pelo CAMINHO OFICIAL — o mesmo de
--    fn_veic_venda_registrar: insere veic_venda_recebimento e DISPARA fn_veic__receber (cria erp_receber e
--    liga receber_id). Nunca insere título "na mão" (regra de ouro: financeiro é da GE, revenda dispara evento).
--    HB20: entrada 6.000 RECEBIDA (paga) · parcela 6.000 EM ABERTO vencida · financiamento 50.000 do BANCO em aberto.
--    Civic: entrada 40.000 (cliente) · financiamento 75.000 (banco), ambos em aberto (venda em negociação).
--    No reset, limpa antes os erp_receber da revenda desta demo (ref_externa_sistema='revenda_veiculos') para o
--    reset ser determinístico (sem acúmulo).
-- 2) fn_demo_seed_revenda_r05 deixa de criar recebimentos (agora é do seed principal); mantém procuras,
--    vistoria e config. O seed principal passa a CHAMÁ-LO no fim, para um fn_demo_reset devolver a demo COMPLETA.
-- 3) fn_veic_venda_acerto ganha "em aberto por devedor" (cliente × banco) — a MESMA fonte (erp_receber via
--    receber_id) que a tela de vendas lê (RD-65).
--
-- Roteiro (RD-70): rodar fn_demo_reset e contar cada tabela antes × depois (iguais). Acerto da HB20:
-- recebido 6.000; em aberto 6.000 do cliente (vencida) + 50.000 do banco.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (A) fn_demo_seed_revenda_r05 SEM o bloco de recebimentos (agora é do seed principal).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_seed_revenda_r05(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_sysrole text; v_is_demo boolean;
  v_corolla   uuid := '415ae6e7-7e1d-4493-9e61-573bb3f9e831';
  v_modelo    uuid;
  v_vist uuid := md5(p_company::text || ':r05:vist:corolla')::uuid;
  v_it_reparo uuid; v_it_ok uuid;
BEGIN
  IF p_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_nulo'); END IF;
  SELECT system_role INTO v_sysrole FROM users WHERE id = auth.uid();
  IF NOT (v_interno OR coalesce(auth.role(),'')='service_role' OR coalesce(v_sysrole,'') IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RAISE EXCEPTION 'Só PS_ADMIN semeia demo' USING errcode='42501'; END IF;
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = p_company;
  IF v_is_demo IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_nao_demo', 'company_id', p_company); END IF;

  -- NB (R4): os recebimentos da HB20 saíram deste seed e passaram ao seed principal
  -- (fn_gold_revenda_seed_reparar), pelo caminho oficial fn_veic__receber → erp_receber.
  -- Aqui ficam apenas procuras, vistoria e o preenchimento de config.

  -- ── Procuras do "O que comprar" ──────────────────────────────────────────────────────────────
  INSERT INTO veic_procura (id, company_id, cliente_nome, contato, marca, modelo, ano_min, ano_max, valor_ate, cambio, observacao, criado_em)
  VALUES
    (md5(p_company::text||':r05:proc:1')::uuid, p_company, 'Marcos Andrade', '(45) 99101-1010', 'Toyota', 'Corolla', 2020, 2023, 120000, 'automatico', 'Quer prata ou preto, baixa km', now()-interval '8 days'),
    (md5(p_company::text||':r05:proc:2')::uuid, p_company, 'Luiza Prado', '(45) 99202-2020', 'Honda', 'HR-V', 2021, 2024, 140000, 'automatico', 'Aceita troca do Onix dela', now()-interval '5 days'),
    (md5(p_company::text||':r05:proc:3')::uuid, p_company, 'Cleber Souza', '(45) 99303-3030', 'Fiat', 'Toro', 2019, 2022, 110000, 'automatico', 'Diesel 4x4', now()-interval '3 days'),
    (md5(p_company::text||':r05:proc:4')::uuid, p_company, 'Renata Lima', '(45) 99404-4040', 'Volkswagen', 'Polo', 2022, 2025, 90000, 'manual', 'Primeiro carro da filha', now()-interval '1 day')
  ON CONFLICT (id) DO NOTHING;

  -- ── Vistoria CONCLUÍDA com reparo (Corolla) ──────────────────────────────────────────────────
  SELECT id INTO v_modelo FROM insp_modelo
    WHERE company_id = p_company AND escopo='veiculo_revenda' AND padrao=true LIMIT 1;
  IF v_modelo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM insp_vistoria WHERE id = v_vist) THEN
    SELECT i.id INTO v_it_reparo FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id
      WHERE r.modelo_id=v_modelo AND i.nome='parachoque dianteiro' LIMIT 1;
    SELECT i.id INTO v_it_ok FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id
      WHERE r.modelo_id=v_modelo AND i.nome='parabrisa' LIMIT 1;
    INSERT INTO insp_vistoria (id, company_id, modelo_id, escopo, alvo_tabela, alvo_id, situacao, km, previsao_total, observacao, iniciada_em, concluida_em)
    VALUES (v_vist, p_company, v_modelo, 'veiculo_revenda', 'veic_veiculo', v_corolla, 'concluida', 48200, 900,
      'Vistoria de demonstração — 1 item em reparo.', now()-interval '6 days', now()-interval '6 days')
    ON CONFLICT (id) DO NOTHING;
    IF v_it_reparo IS NOT NULL THEN
      INSERT INTO insp_resposta (id, company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, foto_path, respondido_em)
      VALUES (md5(p_company::text||':r05:resp:reparo')::uuid, p_company, v_vist, v_it_reparo, 'reparo',
        'Amassado no parachoque dianteiro — reparo + pintura.', 900, 'demo/vistoria-parachoque.jpg', now()-interval '6 days')
      ON CONFLICT (id) DO NOTHING;
    END IF;
    IF v_it_ok IS NOT NULL THEN
      INSERT INTO insp_resposta (id, company_id, vistoria_id, item_id, estado, respondido_em)
      VALUES (md5(p_company::text||':r05:resp:ok')::uuid, p_company, v_vist, v_it_ok, 'ok', now()-interval '6 days')
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;

  -- ── Config da garagem (só preenche o que estiver nulo) ───────────────────────────────────────
  UPDATE veic_config SET
    impostos_venda_pct   = COALESCE(impostos_venda_pct, 4),
    comissao_venda_pct   = COALESCE(comissao_venda_pct, 2),
    provisao_garantia_pct= COALESCE(provisao_garantia_pct, 1.5),
    margem_alvo_pct      = COALESCE(margem_alvo_pct, 12),
    updated_at = now()
  WHERE company_id = p_company;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company, 'procuras', 4,
    'vistoria_concluida_reparo', v_modelo IS NOT NULL,
    'nota', 'recebimentos migrados para o seed principal (caminho oficial fn_veic__receber)');
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (B) fn_gold_revenda_seed_reparar: recebimentos pelo caminho oficial + chamada do r05 no fim.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot  uuid := 'b0700000-0000-4000-a000-000000000003';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_criou int := 0;
  v_id uuid;
  v_rec record;
  v_entrada timestamptz;
  v_titulos int := 0;
  v_rc record; v_vid uuid; v_cli text; v_banco text; v_mod text; v_rec_id uuid; v_receber uuid;
BEGIN
  IF p_company_id <> v_bot THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo');
  END IF;

  INSERT INTO veic_config (company_id, semaforo_verde_ate_dias, semaforo_amarelo_ate_dias, margem_alvo_pct, impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, vagas_operacionais, custo_fixo_mensal_manual, taxa_capital_aa, updated_at)
  VALUES (v_bot, 30, 60, 20, 4, 2, 1.5, 30, 40000, 15, now())
  ON CONFLICT (company_id) DO UPDATE SET
    semaforo_verde_ate_dias=30, semaforo_amarelo_ate_dias=60, margem_alvo_pct=20,
    impostos_venda_pct=4, comissao_venda_pct=2, provisao_garantia_pct=1.5,
    vagas_operacionais=30, custo_fixo_mensal_manual=40000, taxa_capital_aa=15, updated_at=now();

  -- Reset FK-seguro. R4: limpar tambem os erp_receber da revenda desta demo (evento antigo), para o
  -- reset ser determinístico (contagem antes×depois igual) — antes de apagar os recebimentos que os
  -- referenciam. RD-30 proíbe DELETE físico de documento financeiro; aqui é manutenção DELIBERADA de
  -- dado de DEMONSTRAÇÃO (is_demo, synthetic), pelo escape sancionado — local à transação e restrito à
  -- revenda desta demo (jamais toca título de empresa real).
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);
  DELETE FROM erp_receber WHERE company_id=v_bot AND ref_externa_sistema='revenda_veiculos';
  PERFORM set_config('app.permitir_delete_fisico', 'off', true);
  DELETE FROM veic_venda_recebimento WHERE venda_id IN (SELECT id FROM veic_venda WHERE company_id=v_bot);
  DELETE FROM veic_coaf_ocorrencia   WHERE venda_id IN (SELECT id FROM veic_venda WHERE company_id=v_bot);
  DELETE FROM veic_venda   WHERE company_id=v_bot;
  DELETE FROM veic_reserva WHERE company_id=v_bot;
  DELETE FROM veic_custo   WHERE company_id=v_bot;
  DELETE FROM veic_precificacao_hist WHERE company_id=v_bot;
  DELETE FROM veic_veiculo_evento    WHERE company_id=v_bot;

  FOR v_rec IN SELECT * FROM (VALUES
      ('DEMO0REVENDA00001','Fiat',     'Argo 1.0',    'em_preparacao','compra_pj',   5,  38000, NULL::numeric, NULL::numeric, 'recem_entrado',    2022, 2022, 'Branco',  'flex',    41000, 'Recém-entrado — aguardando vistoria.'),
      ('DEMO0REVENDA00002','VW',       'Gol 1.6',     'em_preparacao','compra_pj',  12,  32000, NULL, NULL, 'em_vistoria',      2021, 2021, 'Prata',   'flex',    62000, 'Em vistoria de entrada.'),
      ('DEMO0REVENDA00003','Chevrolet','Onix 1.0',    'disponivel',   'compra_pj',  40,  45000, NULL, NULL, 'com_custos',       2022, 2023, 'Preto',   'flex',    38000, 'Custos de preparação lançados.'),
      ('DEMO0REVENDA00004','Toyota',   'Corolla XEi', 'disponivel',   'compra_pj',  60,  95000, 118000, 110000, 'precificado',    2021, 2022, 'Prata',   'flex',    55000, 'Precificado e anunciado.'),
      ('DEMO0REVENDA00005','Honda',    'Civic EXL',   'reservado',    'compra_pj',  75,  92000, 115000, 108000, 'negociacao_troca',2020, 2021, 'Cinza',   'flex',    68000, 'Em negociação com troca na entrada.'),
      ('DEMO0REVENDA00006','Jeep',     'Compass',     'entregue',     'compra_pj', 120, 120000, 145000, 138000, 'vendido_com_nota',2021, 2022, 'Branco',  'diesel',  49000, 'Vendido com nota — entregue ao cliente.'),
      ('DEMO0REVENDA00007','Hyundai',  'HB20',        'vendido',      'compra_pj',  95,  48000, 62000, 58000, 'vendido_sem_nota', 2020, 2020, 'Vermelho','flex',    71000, 'Vendido sem nota — pendência fiscal a resolver.'),
      ('DEMO0REVENDA00008','Renault',  'Duster',      'disponivel',   'consignacao',50,      0, 78000, 72000, 'consignado',       2021, 2021, 'Marrom',  'flex',    60000, 'Veículo em consignação.'),
      ('DEMO0REVENDA00009','Ford',     'Ka',          'disponivel',   'compra_pj', 150,  30000, 39000, 36000, 'parado_95d',       2019, 2019, 'Prata',   'flex',    88000, 'Parado há muito tempo — semáforo vermelho.'),
      ('DEMO0REVENDA00010','Honda',    'CB 500',      'disponivel',   'compra_pj',  20,  28000, 36000, 34000, 'moto',             2022, 2022, 'Vermelho','gasolina', 12000, 'Motocicleta em estoque.'),
      ('DEMO0REVENDA00011','Nissan',   'Kicks',       'em_preparacao','compra_pj',   8,  70000, NULL, NULL, 'preparacao_os',    2022, 2023, 'Branco',  'flex',    33000, 'Em preparação (OS aberta).'),
      ('DEMO0REVENDA00012','Peugeot',  '208',         'disponivel',   'compra_pj',  45,  42000, 55000, 51000, 'procura_crm',      2021, 2022, 'Azul',    'flex',    47000, 'Alvo de procura no CRM.'),
      ('DEMO0REVENDA00013','Renault',  'Sandero',     'devolvido',    'compra_pj', 175,  40000, 52000, 48000, 'devolvido',        2019, 2020, 'Prata',   'flex',    90000, 'Venda cancelada — veículo devolvido ao estoque.')
    ) AS t(chassi, marca, modelo, situacao, origem, dias, aquis, pvenda, pmin, marcador, anofab, anomod, cor, comb, km, obs)
  LOOP
    SELECT id INTO v_id FROM veic_veiculo WHERE company_id=v_bot AND chassi=v_rec.chassi LIMIT 1;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM veic_veiculo
       WHERE company_id=v_bot AND chassi <> v_rec.chassi AND observacao LIKE '%'||v_rec.marcador
       ORDER BY created_at LIMIT 1;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO veic_veiculo (company_id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, preco_minimo, precificado_em, ativo, observacao, created_by)
      VALUES (v_bot, v_rec.chassi, v_rec.marca, v_rec.modelo, v_rec.anofab, v_rec.anomod, v_rec.cor, v_rec.comb, v_rec.km, v_rec.situacao, v_rec.origem, (current_date - v_rec.dias), v_rec.aquis, v_rec.pvenda, v_rec.pmin,
        CASE WHEN v_rec.pvenda IS NOT NULL THEN now() - interval '3 days' ELSE NULL END, true, v_rec.obs, v_robo)
      RETURNING id INTO v_id;
      v_criou := v_criou + 1;
    ELSE
      UPDATE veic_veiculo SET
        chassi=v_rec.chassi, marca=v_rec.marca, modelo=v_rec.modelo, ano_fabricacao=v_rec.anofab,
        ano_modelo=v_rec.anomod, cor=v_rec.cor, combustivel=v_rec.comb, km_entrada=v_rec.km,
        situacao=v_rec.situacao, origem=v_rec.origem, data_entrada=(current_date - v_rec.dias),
        valor_aquisicao=v_rec.aquis, preco_venda=v_rec.pvenda, preco_minimo=v_rec.pmin,
        precificado_em=CASE WHEN v_rec.pvenda IS NOT NULL THEN now() - interval '3 days' ELSE NULL END,
        ativo=true, observacao=v_rec.obs
      WHERE id=v_id;
    END IF;

    IF v_rec.marcador = 'com_custos' THEN
      INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, data_custo, entra_base_fiscal, created_by) VALUES
        (v_bot, v_id, 'preparacao', 'Revisão + limpeza', 1200, current_date - 35, true, v_robo),
        (v_bot, v_id, 'outro',      'Rateio pátio/estrutura (mês)', 300, current_date - 35, false, v_robo);
    END IF;

    IF v_rec.marcador = 'negociacao_troca' THEN
      INSERT INTO veic_reserva (company_id, veiculo_id, cliente_nome, valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
      VALUES (v_bot, v_id, 'Ricardo Menezes', 2000, 'pix', current_date + 5, 'ativa', v_robo);
      -- Civic: entrada 40.000 + financiamento 75.000 (banco) = 115.000. banco_nome/financiado p/ o termo e o acerto.
      INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda, desconto_embutido_troca, valor_entrada, valor_financiado, banco_nome, situacao, vendedor_nome, observacao, created_by)
      VALUES (v_bot, v_id, 'DEMO-V-0005', 'Ricardo Menezes', '111.444.777-35', current_date - 3, 115000, 5000, 40000, 75000, 'Banco Pan', 'aberta', 'Marcos Souza', 'Troca avaliada 35k, dada 40k (supervalorizada 5k).', v_robo);
    END IF;

    IF v_rec.marcador = 'vendido_com_nota' THEN
      INSERT INTO veic_reserva (company_id, veiculo_id, cliente_nome, valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
      VALUES (v_bot, v_id, 'Aline Ferreira', 3000, 'pix', current_date - 32, 'convertida', v_robo);
      INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda, valor_entrada, situacao, vendedor_nome, observacao, created_by)
      VALUES (v_bot, v_id, 'DEMO-V-0006', 'Aline Ferreira', '529.982.247-25', current_date - 30, 145000, 145000, 'entregue', 'Marcos Souza', 'Venda com nota fiscal.', v_robo);
    ELSIF v_rec.marcador = 'vendido_sem_nota' THEN
      -- HB20: 62.000 = entrada 6.000 (recebida) + parcela 6.000 (vencida) + financiamento 50.000 (banco).
      INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda, valor_entrada, valor_financiado, banco_nome, situacao, vendedor_nome, observacao, created_by)
      VALUES (v_bot, v_id, 'DEMO-V-0007', 'Bruno Tavares', '390.533.447-05', current_date - 20, 62000, 6000, 50000, 'BV Financeira', 'faturada', 'Marcos Souza', 'Venda sem nota — pendência fiscal.', v_robo);
    END IF;

    IF v_rec.marcador = 'consignado' THEN
      INSERT INTO veic_reserva (company_id, veiculo_id, cliente_nome, valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
      VALUES (v_bot, v_id, 'Interessado Duster', 1500, 'pix', current_date - 10, 'expirada', v_robo);
    END IF;

    IF v_rec.marcador = 'procura_crm' THEN
      INSERT INTO veic_reserva (company_id, veiculo_id, cliente_nome, valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
      VALUES (v_bot, v_id, 'Interessado 208', 500, 'pix', current_date - 5, 'cancelada', v_robo);
    END IF;

    IF v_rec.marcador = 'devolvido' THEN
      INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda, valor_entrada, situacao, vendedor_nome, observacao, created_by)
      VALUES (v_bot, v_id, 'DEMO-V-0013', 'Patrícia Gomes', '111.444.777-35', current_date - 40, 52000, 10000, 'cancelada', 'Marcos Souza', 'Venda cancelada — cliente desistiu, veículo devolvido.', v_robo);
    END IF;

    -- HISTÓRICO (T4): eventos + linha do tempo do valor.
    v_entrada := (current_date - v_rec.dias)::timestamptz + interval '9 hours';
    INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, data_evento, usuario_id, payload)
    VALUES (v_bot, v_id, 'entrada',
            format('Entrada no estoque · %s %s (%s km)', v_rec.marca, v_rec.modelo, to_char(v_rec.km, 'FM999G999')),
            v_entrada, v_robo, jsonb_build_object('origem', v_rec.origem, 'valor_aquisicao', v_rec.aquis));

    IF v_rec.marcador = 'com_custos' THEN
      INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, data_evento, usuario_id, payload) VALUES
        (v_bot, v_id, 'custo', 'Custo lançado: Revisão + limpeza (R$ 1.200)',
           (current_date - 35)::timestamptz + interval '10 hours', v_robo, jsonb_build_object('valor', 1200, 'categoria', 'preparacao')),
        (v_bot, v_id, 'custo_excluido', 'Custo removido: lavagem lançada em duplicidade (R$ 90)',
           (current_date - 34)::timestamptz + interval '14 hours', v_robo, jsonb_build_object('valor', 90, 'motivo', 'duplicidade')),
        (v_bot, v_id, 'edicao', 'Dados revisados após preparação (km e observação)',
           (current_date - 33)::timestamptz + interval '11 hours', v_robo, jsonb_build_object('campos', jsonb_build_array('km_atual', 'observacao')));
    END IF;

    IF v_rec.marcador = 'em_vistoria' THEN
      INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, data_evento, usuario_id, payload)
      VALUES (v_bot, v_id, 'edicao', 'Vistoria de entrada: dados conferidos e atualizados',
              (current_date - v_rec.dias + 2)::timestamptz + interval '10 hours', v_robo, jsonb_build_object('campos', jsonb_build_array('cor', 'combustivel', 'km_entrada')));
    END IF;

    IF v_rec.pvenda IS NOT NULL THEN
      INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, data_evento, usuario_id, payload)
      VALUES (v_bot, v_id, 'edicao',
              format('Precificação definida: anunciado R$ %s / piso R$ %s', to_char(v_rec.pvenda, 'FM999G999'), to_char(v_rec.pmin, 'FM999G999')),
              (now() - interval '3 days'), v_robo, jsonb_build_object('preco_venda', v_rec.pvenda, 'preco_minimo', v_rec.pmin));
      INSERT INTO veic_precificacao_hist
        (company_id, veiculo_id, preco_venda, preco_minimo, margem_alvo_pct, custo_base, impostos_pct, comissao_pct, observacao, criado_em, criado_por)
      VALUES
        (v_bot, v_id, round(v_rec.pvenda * CASE WHEN v_rec.marcador='parado_95d' THEN 1.15 ELSE 1.05 END),
           round(v_rec.pmin  * CASE WHEN v_rec.marcador='parado_95d' THEN 1.12 ELSE 1.04 END),
           12, v_rec.aquis, 4, 2,
           CASE WHEN v_rec.marcador='parado_95d' THEN 'Anúncio inicial (preço de tabela).' ELSE 'Primeira precificação.' END,
           (current_date - v_rec.dias + 3)::timestamptz + interval '15 hours', v_robo),
        (v_bot, v_id, v_rec.pvenda, v_rec.pmin, 12, v_rec.aquis, 4, 2,
           CASE WHEN v_rec.marcador='parado_95d' THEN 'Corte de preço para girar (parado há muito tempo).' ELSE 'Ajuste ao mercado.' END,
           (now() - interval '3 days'), v_robo);
    END IF;

    IF v_rec.situacao IN ('disponivel', 'reservado', 'vendido', 'entregue', 'devolvido') THEN
      INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, data_evento, usuario_id, payload)
      VALUES (v_bot, v_id, 'situacao', format('Situação alterada para "%s"', v_rec.situacao),
              (now() - interval '2 days'), v_robo, jsonb_build_object('para', v_rec.situacao));
    END IF;

    IF v_rec.marcador = 'devolvido' THEN
      INSERT INTO veic_veiculo_evento (company_id, veiculo_id, tipo, descricao, data_evento, usuario_id, payload)
      VALUES (v_bot, v_id, 'situacao', 'Venda cancelada — veículo devolvido ao estoque (motivo: cliente desistiu)',
              (current_date - 38)::timestamptz + interval '16 hours', v_robo, jsonb_build_object('motivo', 'cliente_desistiu'));
    END IF;
  END LOOP;

  -- ════════════════════════════════════════════════════════════════════════════════════════════
  -- R4 · RECEBIMENTOS pelo CAMINHO OFICIAL (fn_veic__receber dispara o erp_receber; nunca "na mão").
  -- ════════════════════════════════════════════════════════════════════════════════════════════
  FOR v_rc IN SELECT * FROM (VALUES
      ('DEMO-V-0007','entrada',       'cliente', 6000::numeric,  (current_date - 20), 'pix',           'pago'),
      ('DEMO-V-0007','parcela',       'cliente', 6000::numeric,  (current_date - 3),  'transferencia', 'vencido'),
      ('DEMO-V-0007','financiamento', 'banco',   50000::numeric, (current_date + 5),  'financiamento', 'aberto'),
      ('DEMO-V-0005','entrada',       'cliente', 40000::numeric, (current_date - 3),  'pix',           'aberto'),
      ('DEMO-V-0005','financiamento', 'banco',   75000::numeric, (current_date + 10), 'financiamento', 'aberto')
    ) AS t(vnum, tipo, devedor, valor, venc, forma, status_final)
  LOOP
    SELECT vd.id, vd.cliente_nome, vd.banco_nome, vv.modelo
      INTO v_vid, v_cli, v_banco, v_mod
      FROM veic_venda vd JOIN veic_veiculo vv ON vv.id = vd.veiculo_id
      WHERE vd.company_id = v_bot AND vd.numero = v_rc.vnum AND vd.deleted_at IS NULL LIMIT 1;
    IF v_vid IS NOT NULL THEN
      INSERT INTO veic_venda_recebimento (company_id, venda_id, tipo, devedor, valor, data_prevista, forma_pagamento)
      VALUES (v_bot, v_vid, v_rc.tipo, v_rc.devedor, v_rc.valor, v_rc.venc, v_rc.forma)
      RETURNING id INTO v_rec_id;
      v_receber := fn_veic__receber(v_bot, v_rec_id,
        CASE WHEN v_rc.devedor = 'banco' THEN 'Repasse banco — ' || COALESCE(v_banco,'') || ' — ' || COALESCE(v_mod,'')
             ELSE v_rc.tipo || ' — ' || COALESCE(v_mod,'') || ' — ' || COALESCE(v_cli,'') END,
        v_rc.valor, v_rc.venc, NULL,
        CASE WHEN v_rc.devedor = 'banco' THEN v_banco ELSE v_cli END,
        v_rc.forma, NULL);
      UPDATE veic_venda_recebimento SET receber_id = v_receber WHERE id = v_rec_id;
      -- estado de demonstração do título (o título nasceu 'aberto' pelo caminho oficial):
      IF v_rc.status_final = 'pago' THEN
        UPDATE erp_receber SET status='pago', valor_pago=v_rc.valor, data_pagamento=v_rc.venc WHERE id=v_receber;
      ELSIF v_rc.status_final = 'vencido' THEN
        UPDATE erp_receber SET status='vencido' WHERE id=v_receber;
      END IF;
      v_titulos := v_titulos + 1;
    END IF;
  END LOOP;

  -- RD-69: um fn_demo_reset devolve a demo COMPLETA — restaura procuras, vistoria e config.
  PERFORM fn_demo_seed_revenda_r05(v_bot);

  RETURN jsonb_build_object('ok', true, 'criou', v_criou,
    'veiculos', (SELECT count(*) FROM veic_veiculo WHERE company_id=v_bot),
    'eventos', (SELECT count(*) FROM veic_veiculo_evento WHERE company_id=v_bot),
    'precificacao_hist', (SELECT count(*) FROM veic_precificacao_hist WHERE company_id=v_bot),
    'recebimentos', v_titulos,
    'erp_receber_revenda', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND ref_externa_sistema='revenda_veiculos'),
    'procuras', (SELECT count(*) FROM veic_procura WHERE company_id=v_bot),
    'por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_veiculo WHERE company_id=v_bot GROUP BY situacao) s),
    'vendas_por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_venda WHERE company_id=v_bot GROUP BY situacao) s));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- (C) fn_veic_venda_acerto: "em aberto POR DEVEDOR" (cliente × banco), mesma fonte da tela (RD-65).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_venda_acerto(p_venda_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v record; v_conta jsonb; v_preco numeric; v_custo_real numeric; v_lucro_proj numeric;
  v_recebido numeric; v_aberto numeric; v_aberto_cli numeric; v_aberto_bco numeric;
  v_custos_pos numeric; v_lucro_real numeric;
BEGIN
  SELECT s.id, s.company_id, s.veiculo_id, s.valor_venda, s.retorno_banco, s.data_venda
    INTO v FROM veic_venda s WHERE s.id = p_venda_id AND s.deleted_at IS NULL;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_conta := fn_veic_conta_do_carro(v.veiculo_id);
  v_preco := v.valor_venda; v_custo_real := NULLIF(v_conta->>'custo_real_total','')::numeric;
  v_lucro_proj := NULLIF(v_conta->>'lucro_real_projetado','')::numeric;

  SELECT
    COALESCE(sum(CASE WHEN er.status IN ('pago','parcial') THEN COALESCE(er.valor_pago,0) ELSE 0 END),0),
    COALESCE(sum(CASE WHEN er.status IN ('aberto','vencido','parcial') THEN COALESCE(er.valor,r.valor)-COALESCE(er.valor_pago,0)
                      WHEN er.id IS NULL THEN COALESCE(r.valor,0) ELSE 0 END),0),
    COALESCE(sum(CASE WHEN COALESCE(r.devedor,'cliente')<>'banco' AND (er.status IN ('aberto','vencido','parcial') OR er.id IS NULL)
                      THEN COALESCE(er.valor,r.valor)-COALESCE(er.valor_pago,0) ELSE 0 END),0),
    COALESCE(sum(CASE WHEN COALESCE(r.devedor,'cliente')='banco' AND (er.status IN ('aberto','vencido','parcial') OR er.id IS NULL)
                      THEN COALESCE(er.valor,r.valor)-COALESCE(er.valor_pago,0) ELSE 0 END),0)
    INTO v_recebido, v_aberto, v_aberto_cli, v_aberto_bco
    FROM veic_venda_recebimento r LEFT JOIN erp_receber er ON er.id = r.receber_id
   WHERE r.venda_id = p_venda_id;

  SELECT COALESCE(sum(valor),0) INTO v_custos_pos
    FROM veic_custo WHERE veiculo_id = v.veiculo_id AND deleted_at IS NULL AND data_custo > v.data_venda;

  v_lucro_real := CASE WHEN v_custo_real IS NULL THEN NULL
                       ELSE round(v_recebido + COALESCE(v.retorno_banco,0) - v_custo_real - v_custos_pos, 2) END;

  RETURN jsonb_build_object('ok', true,
    'previsto', jsonb_build_object('preco_venda', v_preco, 'custo_real_total', v_custo_real, 'lucro_projetado', v_lucro_proj),
    'realizado', jsonb_build_object(
      'recebido', round(v_recebido,2),
      'em_aberto', round(v_aberto,2),
      'em_aberto_cliente', round(v_aberto_cli,2),
      'em_aberto_banco', round(v_aberto_bco,2),
      'custos_pos_venda', round(v_custos_pos,2),
      'lucro_real', v_lucro_real));
END $function$;

-- Aplica na Demo ao aplicar (deploy-migrations roda no push da main). Idempotente e só [BOT] Revenda.
SELECT public.fn_gold_revenda_seed_reparar('b0700000-0000-4000-a000-000000000003');
