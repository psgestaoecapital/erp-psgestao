-- RD-69 (contexto 111074e2) — R1a vira "Demonstração · Revenda de Veículos"
--
-- Eng. Chefe 19/09: a empresa de teste da Revenda NÃO é um novo [BOT]; é a empresa de
-- DEMONSTRAÇÃO da vertical (companies.is_demo=true). Padrão RD-69: identidade de demonstração
-- (nome sem "[BOT]"), CNPJ com DV válido e não-colidente, dados fictícios com documentos de DV
-- válido, ~6 meses de histórico e TODOS os estados do ciclo (veículo, venda e reserva).
--
-- Empresa: b0700000-0000-4000-a000-000000000003 (já is_demo=true; era "[BOT] Revenda — auditoria Gold").
--
-- Duas partes:
--  1) Renomeia a empresa e grava CNPJ válido não-colidente (11.222.333/0001-81 → dígitos).
--  2) Reescreve fn_gold_revenda_seed_reparar: idempotente e AUTO-MIGRANTE — casa as 12 linhas
--     legadas pelo marcador (na observação "[BOT] <marcador>"), migra para os valores canônicos
--     (chassi realista, sem "[BOT]", 6 meses de histórico), e acrescenta o 13º veículo 'devolvido'.
--     Os filhos gerenciados pelo seed (venda/reserva/custo e netos) são zerados e reinseridos —
--     reset FK-seguro que NÃO apaga o veículo (evita mexer em erp_os/erp_crm_oportunidade).

-- ── 1) Empresa de demonstração (cria se não existir; idempotente) ─────────────────────────────────
-- Substitui o seed [BOT] do R1a (#1581): a empresa nasce/atualiza já com a identidade de DEMONSTRAÇÃO.
-- Em produção a empresa já existe (aplicada ao vivo pelo #1581) → cai no DO UPDATE; num rebuild do zero
-- é criada aqui, para o seed abaixo ter FK válido (veic_config/veic_veiculo → companies).
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin)
VALUES ('b0700000-0000-4000-a000-000000000003', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Demonstração Revenda de Veículos LTDA', 'Demonstração · Revenda de Veículos',
        true, 'auditoria', '11222333000181', false)
ON CONFLICT (id) DO UPDATE SET
  razao_social  = EXCLUDED.razao_social,
  nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false,
  cnpj = '11222333000181';   -- DV válido, não-colidente (verificado)

-- acesso do robô (screenshot@) à empresa de demonstração
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa', 'b0700000-0000-4000-a000-000000000003', 'adm'
WHERE NOT EXISTS (SELECT 1 FROM public.user_companies
  WHERE user_id='74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa' AND company_id='b0700000-0000-4000-a000-000000000003');

-- assinatura v15_revenda ativa (tenant é uma revenda de verdade; robô PS_ADMIN já isento do gating)
INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl)
SELECT 'b0700000-0000-4000-a000-000000000003', 'v15_revenda', 'active', 0
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions
  WHERE company_id='b0700000-0000-4000-a000-000000000003' AND plan_id='v15_revenda');

-- ── 2) Seed determinístico da demonstração ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_reparar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot  uuid := 'b0700000-0000-4000-a000-000000000003';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_criou int := 0;
  v_id uuid;
  v_rec record;
BEGIN
  IF p_company_id <> v_bot THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo');
  END IF;

  -- Config da vertical (idempotente).
  INSERT INTO veic_config (company_id, semaforo_verde_ate_dias, semaforo_amarelo_ate_dias, margem_alvo_pct, impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, updated_at)
  VALUES (v_bot, 30, 60, 12, 4, 2, 1.5, now())
  ON CONFLICT (company_id) DO UPDATE SET
    semaforo_verde_ate_dias=30, semaforo_amarelo_ate_dias=60, margem_alvo_pct=12,
    impostos_venda_pct=4, comissao_venda_pct=2, provisao_garantia_pct=1.5, updated_at=now();

  -- Reset FK-seguro dos filhos gerenciados pelo seed (netos → filhos). O veículo NÃO é apagado
  -- (tem FKs de erp_os/erp_crm_oportunidade); ele é atualizado in-place no laço abaixo.
  DELETE FROM veic_venda_recebimento WHERE venda_id IN (SELECT id FROM veic_venda WHERE company_id=v_bot);
  DELETE FROM veic_coaf_ocorrencia   WHERE venda_id IN (SELECT id FROM veic_venda WHERE company_id=v_bot);
  DELETE FROM veic_venda   WHERE company_id=v_bot;
  DELETE FROM veic_reserva WHERE company_id=v_bot;
  DELETE FROM veic_custo   WHERE company_id=v_bot;

  FOR v_rec IN SELECT * FROM (VALUES
      -- chassi(17),           marca,       modelo,        situacao,       origem,       dias, aquis,  pvenda,  pmin,   marcador,           anofab, anomod, cor,       comb,      km,    obs
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
    -- 1º casa pelo chassi canônico (runs após a 1ª); 2º migra a linha legada pelo marcador na observação.
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

    -- Filhos por cenário (documentos com DV válido e não-colidente; nomes fictícios; e-mails não aplicáveis aqui).
    IF v_rec.marcador = 'com_custos' THEN
      INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, data_custo, entra_base_fiscal, created_by) VALUES
        (v_bot, v_id, 'preparacao', 'Revisão + limpeza', 1200, current_date - 35, true, v_robo),
        (v_bot, v_id, 'outro',      'Rateio pátio/estrutura (mês)', 300, current_date - 35, false, v_robo);
    END IF;

    IF v_rec.marcador = 'negociacao_troca' THEN
      INSERT INTO veic_reserva (company_id, veiculo_id, cliente_nome, valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
      VALUES (v_bot, v_id, 'Ricardo Menezes', 2000, 'pix', current_date + 5, 'ativa', v_robo);
      INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda, desconto_embutido_troca, valor_entrada, situacao, vendedor_nome, observacao, created_by)
      VALUES (v_bot, v_id, 'DEMO-V-0005', 'Ricardo Menezes', '111.444.777-35', current_date - 3, 115000, 5000, 40000, 'aberta', 'Marcos Souza', 'Troca avaliada 35k, dada 40k (supervalorizada 5k).', v_robo);
    END IF;

    IF v_rec.marcador = 'vendido_com_nota' THEN
      INSERT INTO veic_reserva (company_id, veiculo_id, cliente_nome, valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
      VALUES (v_bot, v_id, 'Aline Ferreira', 3000, 'pix', current_date - 32, 'convertida', v_robo);
      INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda, valor_entrada, situacao, vendedor_nome, observacao, created_by)
      VALUES (v_bot, v_id, 'DEMO-V-0006', 'Aline Ferreira', '529.982.247-25', current_date - 30, 145000, 145000, 'entregue', 'Marcos Souza', 'Venda com nota fiscal.', v_robo);
    ELSIF v_rec.marcador = 'vendido_sem_nota' THEN
      INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda, valor_entrada, situacao, vendedor_nome, observacao, created_by)
      VALUES (v_bot, v_id, 'DEMO-V-0007', 'Bruno Tavares', '390.533.447-05', current_date - 20, 62000, 62000, 'faturada', 'Marcos Souza', 'Venda sem nota — pendência fiscal.', v_robo);
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
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'criou', v_criou,
    'veiculos', (SELECT count(*) FROM veic_veiculo WHERE company_id=v_bot),
    'por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_veiculo WHERE company_id=v_bot GROUP BY situacao) s),
    'vendas_por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_venda WHERE company_id=v_bot GROUP BY situacao) s),
    'reservas_por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_reserva WHERE company_id=v_bot GROUP BY situacao) s),
    'meses_de_historico', (SELECT round(extract(epoch FROM (max(data_entrada)::timestamp - min(data_entrada)::timestamp))/2629800.0, 1) FROM veic_veiculo WHERE company_id=v_bot));
END $function$;
