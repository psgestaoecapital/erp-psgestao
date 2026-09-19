-- =============================================================================
-- Revenda R1a · Sandbox [BOT] Revenda — auditoria Gold (contexto 23752d5a)
-- Mesma receita da [BOT] Agência (#1540 · 20260918190000) e Oficina (20260914120000).
-- Regras: ZERO escrita fora da empresa-bot (o seed recusa company_id ≠ bot). RD-30 (nada dropado).
-- RD-52 idempotente (2ª execução insere 0). Segurança: fn SECURITY DEFINER, REVOKE anon/public/authenticated,
-- GRANT service_role. Valores FICTÍCIOS. NÃO emite NFS-e (🔒) — "vendido sem nota" fica com nfe_id NULL
-- (a trava aparece); "vendido com nota" e vistoria-respostas/erp_os/procura entram na parte 2 do R1a.
-- ambiente_tenant='auditoria' já está no CHECK de companies.
-- =============================================================================

-- empresa-bot da Revenda (id fixo, sintética, isolada por ambiente_tenant='auditoria')
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant)
VALUES ('b0700000-0000-4000-a000-000000000003', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        '[BOT] Revenda — auditoria Gold', '[BOT] Revenda — auditoria Gold', true, 'auditoria')
ON CONFLICT (id) DO UPDATE SET is_demo = true, ambiente_tenant = 'auditoria',
  restrita_ps_admin = false, razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia;

-- acesso do robô (screenshot@) à empresa-bot
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa', 'b0700000-0000-4000-a000-000000000003', 'adm'
WHERE NOT EXISTS (SELECT 1 FROM public.user_companies
  WHERE user_id='74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa' AND company_id='b0700000-0000-4000-a000-000000000003');

-- assinatura v15_revenda ativa (para o tenant ser uma revenda de verdade; robô PS_ADMIN já isento do gating)
INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl)
SELECT 'b0700000-0000-4000-a000-000000000003', 'v15_revenda', 'active', 0
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions
  WHERE company_id='b0700000-0000-4000-a000-000000000003' AND plan_id='v15_revenda');

CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot  uuid := 'b0700000-0000-4000-a000-000000000003';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_criou int := 0;
  v_id uuid;
  v_rec record;
BEGIN
  IF p_company_id <> v_bot THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_bot');
  END IF;

  -- veic_config fictícia (impostos/comissão/garantia/margem alvo + semáforos de dias parado)
  INSERT INTO veic_config (company_id, semaforo_verde_ate_dias, semaforo_amarelo_ate_dias, margem_alvo_pct,
                           impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, updated_at)
  VALUES (v_bot, 30, 60, 12, 4, 2, 1.5, now())
  ON CONFLICT (company_id) DO UPDATE SET
    semaforo_verde_ate_dias=30, semaforo_amarelo_ate_dias=60, margem_alvo_pct=12,
    impostos_venda_pct=4, comissao_venda_pct=2, provisao_garantia_pct=1.5, updated_at=now();

  -- 12 veículos cobrindo o ciclo. Chassi determinístico BOTREV00NN (idempotente por company+chassi).
  -- Cada linha: chassi, marca, modelo, situacao, origem, dias_entrada, valor_aquisicao, preco_venda, preco_minimo
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('BOTREV0001','Fiat','Argo 1.0','em_preparacao','compra_pj', 2,  38000, NULL::numeric, NULL::numeric, 'recem_entrado'),
      ('BOTREV0002','VW','Gol 1.6','em_preparacao','compra_pj',    3,  32000, NULL, NULL, 'em_vistoria'),
      ('BOTREV0003','Chevrolet','Onix 1.0','disponivel','compra_pj',10, 45000, NULL, NULL, 'com_custos'),
      ('BOTREV0004','Toyota','Corolla XEi','disponivel','compra_pj',12, 95000, 118000, 110000, 'precificado'),
      ('BOTREV0005','Honda','Civic EXL','reservado','compra_pj',   18, 92000, 115000, 108000, 'negociacao_troca'),
      ('BOTREV0006','Jeep','Compass','entregue','compra_pj',       25, 120000, 145000, 138000, 'vendido_com_nota'),
      ('BOTREV0007','Hyundai','HB20','vendido','compra_pj',        20, 48000, 62000, 58000, 'vendido_sem_nota'),
      ('BOTREV0008','Renault','Duster','disponivel','consignacao',     15, 0, 78000, 72000, 'consignado'),
      ('BOTREV0009','Ford','Ka','disponivel','compra_pj',          95, 30000, 39000, 36000, 'parado_95d'),
      ('BOTREV0010','Honda','CB 500','disponivel','compra_pj',      8,  28000, 36000, 34000, 'moto'),
      ('BOTREV0011','Nissan','Kicks','em_preparacao','compra_pj',   6,  70000, NULL, NULL, 'preparacao_os'),
      ('BOTREV0012','Peugeot','208','disponivel','compra_pj',      40,  42000, 55000, 51000, 'procura_crm')
    ) AS t(chassi, marca, modelo, situacao, origem, dias, aquis, pvenda, pmin, marcador)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM veic_veiculo WHERE company_id=v_bot AND chassi=v_rec.chassi) THEN
      INSERT INTO veic_veiculo (company_id, chassi, placa, marca, modelo, ano_fabricacao, ano_modelo, cor,
        combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, preco_minimo,
        precificado_em, ativo, observacao, created_by)
      VALUES (v_bot, v_rec.chassi, NULL, v_rec.marca, v_rec.modelo, 2022, 2023, 'Prata',
        'flex', 45000, v_rec.situacao, v_rec.origem, (current_date - v_rec.dias), v_rec.aquis, v_rec.pvenda, v_rec.pmin,
        CASE WHEN v_rec.pvenda IS NOT NULL THEN now() - interval '3 days' ELSE NULL END,
        true, '[BOT] '||v_rec.marcador, v_robo)
      RETURNING id INTO v_id;
      v_criou := v_criou + 1;

      -- Custos no "com_custos" (1 direto + 1 rateado)
      IF v_rec.marcador = 'com_custos' THEN
        INSERT INTO veic_custo (company_id, veiculo_id, categoria, descricao, valor, data_custo, entra_base_fiscal, created_by) VALUES
          (v_bot, v_id, 'preparacao', '[BOT] Revisão + limpeza (direto)', 1200, current_date - 8, true, v_robo),
          (v_bot, v_id, 'outro', '[BOT] Rateio pátio/estrutura (mês)', 300, current_date - 8, false, v_robo);
      END IF;

      -- Reserva ativa no "negociacao_troca" (sinal); troca supervalorizada é registrada na venda depois (parte 2)
      IF v_rec.marcador = 'negociacao_troca' THEN
        INSERT INTO veic_reserva (company_id, veiculo_id, cliente_nome, valor_sinal, forma_sinal, reservado_ate, situacao, created_by)
        VALUES (v_bot, v_id, '[BOT] Comprador Civic', 2000, 'pix', current_date + 5, 'ativa', v_robo);
      END IF;

      -- Vendas: "com nota" (nfe_id NULL nesta fase — 🔒 sem emitir NFS-e) e "sem nota" (trava aparece).
      IF v_rec.marcador = 'vendido_com_nota' THEN
        INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda,
          valor_entrada, situacao, vendedor_nome, observacao, created_by)
        VALUES (v_bot, v_id, 'BOT-V-0001', '[BOT] Comprador Compass', '000.000.000-00', current_date - 2, 145000,
          145000, 'entregue', '[BOT] Vendedor', '[BOT] representa venda COM nota (nfe sintética na parte 2)', v_robo);
      ELSIF v_rec.marcador = 'vendido_sem_nota' THEN
        INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, cliente_doc, data_venda, valor_venda,
          valor_entrada, situacao, vendedor_nome, observacao, created_by)
        VALUES (v_bot, v_id, 'BOT-V-0002', '[BOT] Comprador HB20', '000.000.000-00', current_date - 1, 60000,
          60000, 'faturada', '[BOT] Vendedor', '[BOT] SEM nota (nfe_id NULL) — a trava de emissão deve aparecer', v_robo);
      END IF;

      -- Troca supervalorizada no "negociacao_troca": registra desconto embutido (avaliado 35k, dado 40k → 5k) numa venda pendente.
      IF v_rec.marcador = 'negociacao_troca' THEN
        INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, data_venda, valor_venda,
          desconto_embutido_troca, valor_entrada, situacao, vendedor_nome, observacao, created_by)
        VALUES (v_bot, v_id, 'BOT-V-0003', '[BOT] Comprador Civic', current_date, 115000,
          5000, 40000, 'aberta', '[BOT] Vendedor', '[BOT] troca avaliada 35k, dada 40k (supervalorizada 5k)', v_robo);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'criou', v_criou,
    'veiculos', (SELECT count(*) FROM veic_veiculo WHERE company_id=v_bot),
    'por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_veiculo WHERE company_id=v_bot GROUP BY situacao) s));
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_gold_revenda_seed_reparar(uuid) FROM anon, public, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_gold_revenda_seed_reparar(uuid) TO service_role;
