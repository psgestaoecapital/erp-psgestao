-- Revenda R5a · Negociação (banco) — Tela 9
--
-- A negociação é a composição real do negócio em linguagem de dono: o cliente paga X, você recebe Y,
-- a troca embutiu R$ Z de desconto. Simulador ao vivo (lucro real via fn_veic_conta_do_carro), alçada
-- (desconto acima do permitido exige aprovação do gerente, registrada) e alerta COAF (espécie acima do
-- limite configurado). Fechar gera a venda + recebimentos pelo CAMINHO OFICIAL (fn_veic_venda_registrar).
-- RDs 25·38·51·55·65·70. Idempotente/aditivo; RLS por empresa; sem anon. Regra de ouro: financeiro é da GE.

-- Alçada e COAF são CONFIGURÁVEIS por empresa (RD-51: sem valor, "não configurado" — não inventamos limite legal).
ALTER TABLE veic_config ADD COLUMN IF NOT EXISTS desconto_max_pct numeric;      -- desconto (% do preço pedido) sem aprovação
ALTER TABLE veic_config ADD COLUMN IF NOT EXISTS coaf_limite_especie numeric;   -- limite de espécie que dispara alerta COAF

CREATE TABLE IF NOT EXISTS veic_negociacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES veic_veiculo(id) ON DELETE CASCADE,
  cliente_nome text, cliente_doc text, vendedor_nome text,
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta','fechada','perdida')),
  validade date, motivo_perda text,
  preco_pedido numeric, desconto numeric NOT NULL DEFAULT 0,
  troca_avaliacao numeric, troca_valor_dado numeric, troca_chassi text, troca_marca text, troca_modelo text, troca_ano int, troca_km numeric,
  entrada numeric NOT NULL DEFAULT 0, financiado numeric NOT NULL DEFAULT 0, banco_nome text, parcelas int, retorno_banco numeric NOT NULL DEFAULT 0,
  outros_debitos numeric NOT NULL DEFAULT 0, outros_debitos_desc text,
  especie_valor numeric NOT NULL DEFAULT 0,
  aprovacao_necessaria boolean NOT NULL DEFAULT false, aprovado_por uuid, aprovado_em timestamptz, aprovacao_motivo text,
  venda_id uuid REFERENCES veic_venda(id) ON DELETE SET NULL,
  observacao text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_veic_negociacao_company ON veic_negociacao(company_id, estado);
CREATE INDEX IF NOT EXISTS ix_veic_negociacao_veiculo ON veic_negociacao(veiculo_id);
ALTER TABLE veic_negociacao ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_negociacao'::regclass AND polname='veic_negociacao_rw') THEN
    CREATE POLICY veic_negociacao_rw ON veic_negociacao FOR ALL
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_negociacao TO authenticated;
GRANT ALL ON public.veic_negociacao TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- fn_veic_negociacao_simular — composição ao vivo: lucro real, margem × mínima, alçada, COAF.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_negociacao_simular(p_neg_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  n record; cfg record; v_conta jsonb;
  v_custo_real numeric; v_enc numeric; v_preco_final numeric; v_sobrepreco numeric; v_lucro numeric;
  v_margem_pct numeric; v_desc_pct numeric; v_alcada text; v_coaf text; v_recebe_cliente numeric; v_recebe_banco numeric;
BEGIN
  SELECT * INTO n FROM veic_negociacao WHERE id = p_neg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_encontrada'); END IF;
  IF NOT (n.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT margem_minima_pct, desconto_max_pct, coaf_limite_especie INTO cfg FROM veic_config WHERE company_id = n.company_id;

  v_conta := fn_veic_conta_do_carro(n.veiculo_id);
  v_custo_real := NULLIF(v_conta->>'custo_real_total','')::numeric;
  v_enc := COALESCE(NULLIF(v_conta->>'encargos_pct','')::numeric, 0) / 100.0;
  v_preco_final := COALESCE(n.preco_pedido,0) - COALESCE(n.desconto,0);
  v_sobrepreco := CASE WHEN n.troca_valor_dado IS NOT NULL AND n.troca_avaliacao IS NOT NULL
                       THEN n.troca_valor_dado - n.troca_avaliacao ELSE 0 END;
  -- lucro real: preço líquido menos encargos e custo real, menos o sobrepreço embutido na troca, mais o retorno do banco
  v_lucro := CASE WHEN v_custo_real IS NULL THEN NULL
                  ELSE round(v_preco_final*(1-v_enc) - v_custo_real - v_sobrepreco + COALESCE(n.retorno_banco,0), 2) END;
  v_margem_pct := CASE WHEN v_custo_real IS NOT NULL AND v_custo_real > 0 AND v_lucro IS NOT NULL
                       THEN round(v_lucro / v_custo_real * 100, 2) END;
  v_desc_pct := CASE WHEN COALESCE(n.preco_pedido,0) > 0 THEN round(COALESCE(n.desconto,0)/n.preco_pedido*100, 2) ELSE 0 END;

  -- Alçada: precisa de aprovação se o desconto passa do máximo permitido, OU a margem cai abaixo da mínima.
  v_alcada := CASE
    WHEN cfg.desconto_max_pct IS NOT NULL AND v_desc_pct > cfg.desconto_max_pct THEN 'exige_aprovacao'
    WHEN cfg.margem_minima_pct IS NOT NULL AND v_margem_pct IS NOT NULL AND v_margem_pct < cfg.margem_minima_pct THEN 'exige_aprovacao'
    ELSE 'ok' END;
  -- COAF: espécie acima do limite configurado alerta; sem limite configurado, não finge (RD-51).
  v_coaf := CASE
    WHEN cfg.coaf_limite_especie IS NULL THEN 'nao_configurado'
    WHEN COALESCE(n.especie_valor,0) > cfg.coaf_limite_especie THEN 'alerta'
    ELSE 'ok' END;

  v_recebe_cliente := COALESCE(n.entrada,0) + (v_preco_final - COALESCE(n.entrada,0) - COALESCE(n.financiado,0));
  v_recebe_banco := COALESCE(n.financiado,0) + COALESCE(n.retorno_banco,0);

  RETURN jsonb_build_object('ok', true, 'estado', n.estado,
    'preco_pedido', n.preco_pedido, 'desconto', n.desconto, 'preco_final', v_preco_final,
    'desconto_pct', v_desc_pct,
    'sobrepreco_troca', v_sobrepreco,
    'custo_real', v_custo_real, 'encargos_pct', NULLIF(v_conta->>'encargos_pct','')::numeric,
    'lucro_real', v_lucro, 'margem_pct', v_margem_pct,
    'margem_minima_pct', cfg.margem_minima_pct, 'desconto_max_pct', cfg.desconto_max_pct,
    'alcada', v_alcada,
    'coaf', jsonb_build_object('status', v_coaf, 'especie', n.especie_valor, 'limite', cfg.coaf_limite_especie),
    'em_linguagem_de_dono', jsonb_build_object(
      'o_cliente_paga', v_preco_final,
      'voce_recebe_do_cliente', v_recebe_cliente,
      'voce_recebe_do_banco', v_recebe_banco,
      'a_troca_embutiu_desconto', v_sobrepreco));
END $function$;

-- Aprovação do gerente (registrada) — libera o fechamento quando a alçada exige.
CREATE OR REPLACE FUNCTION public.fn_veic_negociacao_aprovar(p_neg_id uuid, p_motivo text, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM veic_negociacao WHERE id = p_neg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_negociacao SET aprovado_por = p_user, aprovado_em = now(), aprovacao_motivo = p_motivo, updated_at = now()
   WHERE id = p_neg_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- fn_veic_negociacao_fechar — gera a venda + recebimentos pelo caminho oficial (fn_veic_venda_registrar).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_negociacao_fechar(p_neg_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  n record; sim jsonb; v_preco_final numeric; v_recebs jsonb := '[]'::jsonb; v_troca jsonb := NULL; v_res jsonb;
BEGIN
  SELECT * INTO n FROM veic_negociacao WHERE id = p_neg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_encontrada'); END IF;
  IF NOT (n.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF n.estado <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_aberta', 'estado', n.estado); END IF;

  sim := fn_veic_negociacao_simular(p_neg_id);
  -- aprovação registrada = aprovado_em preenchido (não depende do uuid do aprovador, que pode faltar).
  IF (sim->>'alcada') = 'exige_aprovacao' AND n.aprovado_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'aprovacao_pendente',
      'mensagem', 'Desconto/margem acima da alçada — precisa da aprovação do gerente antes de fechar.'); END IF;

  v_preco_final := COALESCE(n.preco_pedido,0) - COALESCE(n.desconto,0);
  -- recebimentos pelo devedor certo (o registrar dispara o erp_receber)
  IF COALESCE(n.entrada,0) > 0 THEN
    v_recebs := v_recebs || jsonb_build_array(jsonb_build_object('tipo','entrada','devedor','cliente','valor',n.entrada,'forma_pagamento','pix'));
  END IF;
  IF (v_preco_final - COALESCE(n.entrada,0) - COALESCE(n.financiado,0)) > 0 THEN
    v_recebs := v_recebs || jsonb_build_array(jsonb_build_object('tipo','parcela','devedor','cliente','valor', v_preco_final - COALESCE(n.entrada,0) - COALESCE(n.financiado,0),'forma_pagamento','boleto'));
  END IF;
  IF COALESCE(n.financiado,0) > 0 THEN
    v_recebs := v_recebs || jsonb_build_array(jsonb_build_object('tipo','financiamento','devedor','banco','valor',n.financiado,'forma_pagamento','financiamento'));
  END IF;
  IF n.troca_chassi IS NOT NULL AND btrim(n.troca_chassi) <> '' THEN
    v_troca := jsonb_build_object('chassi', n.troca_chassi, 'marca', n.troca_marca, 'modelo', n.troca_modelo,
      'ano_fabricacao', n.troca_ano, 'ano_modelo', n.troca_ano, 'km', n.troca_km,
      'valor_troca', n.troca_valor_dado, 'valor_avaliacao', n.troca_avaliacao);
  END IF;

  v_res := fn_veic_venda_registrar(n.company_id, n.veiculo_id,
    jsonb_build_object('cliente_nome', n.cliente_nome, 'cliente_doc', n.cliente_doc,
      'valor_venda', v_preco_final, 'valor_entrada', n.entrada, 'valor_financiado', n.financiado,
      'banco_nome', n.banco_nome, 'retorno_banco', n.retorno_banco, 'vendedor_nome', n.vendedor_nome,
      'observacao', 'Fechada da negociação'),
    v_recebs, v_troca, p_user);
  IF (v_res->>'ok') IS DISTINCT FROM 'true' THEN RETURN v_res; END IF;

  UPDATE veic_negociacao SET estado = 'fechada', venda_id = (v_res->>'id')::uuid, updated_at = now() WHERE id = p_neg_id;
  RETURN jsonb_build_object('ok', true, 'venda_id', v_res->>'id', 'n_titulos', v_res->>'n_titulos');
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_negociacao_perder(p_neg_id uuid, p_motivo text, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_estado text;
BEGIN
  SELECT company_id, estado INTO v_comp, v_estado FROM veic_negociacao WHERE id = p_neg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_estado <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_aberta'); END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  UPDATE veic_negociacao SET estado='perdida', motivo_perda=p_motivo, updated_at=now() WHERE id=p_neg_id;
  RETURN jsonb_build_object('ok', true, 'estado', 'perdida');
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Seed determinístico das negociações da demo (RD-69) — chamado pelo fn_gold_revenda_seed_reparar.
-- Define também os limites demo de alçada/COAF (configuráveis; aqui valores de demonstração).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_negociacoes(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_bot uuid := 'b0700000-0000-4000-a000-000000000003'; v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_corolla uuid; v_ka uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;
  -- limites demo (o dono ajusta na configuração; aqui só para a demonstração da alçada e do COAF)
  UPDATE veic_config SET desconto_max_pct = 5, coaf_limite_especie = 30000, updated_at = now() WHERE company_id = v_bot;

  SELECT id INTO v_corolla FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00004' LIMIT 1;
  SELECT id INTO v_ka      FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00009' LIMIT 1;

  -- reset determinístico das negociações da demo
  DELETE FROM veic_negociacao WHERE company_id = v_bot;

  -- 1) ABERTA com troca supervalorizada (avaliada 35k, dada 40k → embute 5k) + desconto acima da alçada + espécie acima do COAF
  IF v_corolla IS NOT NULL THEN
    INSERT INTO veic_negociacao (id, company_id, veiculo_id, cliente_nome, cliente_doc, vendedor_nome, estado, validade,
      preco_pedido, desconto, troca_avaliacao, troca_valor_dado, troca_chassi, troca_marca, troca_modelo, troca_ano, troca_km,
      entrada, financiado, banco_nome, parcelas, especie_valor, observacao, created_by)
    VALUES (md5(v_bot::text||':neg:aberta')::uuid, v_bot, v_corolla, 'Fernanda Dias', '390.533.447-05', 'Marcos Souza', 'aberta', current_date + 7,
      118000, 8000, 35000, 40000, '9BWERTUIO12345678', 'Chevrolet', 'Onix', 2018, 96000,
      20000, 53000, 'Banco Pan', 24, 35000, 'Cliente quer levar hoje; troca do Onix 2018.', v_robo);
  END IF;

  -- 2) PERDIDA (com motivo)
  IF v_ka IS NOT NULL THEN
    INSERT INTO veic_negociacao (id, company_id, veiculo_id, cliente_nome, vendedor_nome, estado, preco_pedido, desconto, motivo_perda, created_by)
    VALUES (md5(v_bot::text||':neg:perdida')::uuid, v_bot, v_ka, 'Otávio Ramos', 'Marcos Souza', 'perdida', 39000, 0, 'Cliente comprou em outra loja por preço menor.', v_robo);
  END IF;

  RETURN jsonb_build_object('ok', true, 'negociacoes', (SELECT count(*) FROM veic_negociacao WHERE company_id=v_bot));
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- fn_gold_revenda_seed_reparar recriada só para CHAMAR o seed das negociações no fim (RD-69, seed único).
-- Corpo idêntico ao vigente (#1640) + PERFORM fn_gold_revenda_seed_negociacoes(v_bot) e a chave no RETURN.
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

  -- R5a (RD-69): as negociações da demo também nascem do seed único.
  PERFORM fn_gold_revenda_seed_negociacoes(v_bot);

  RETURN jsonb_build_object('ok', true, 'criou', v_criou,
    'veiculos', (SELECT count(*) FROM veic_veiculo WHERE company_id=v_bot),
    'eventos', (SELECT count(*) FROM veic_veiculo_evento WHERE company_id=v_bot),
    'precificacao_hist', (SELECT count(*) FROM veic_precificacao_hist WHERE company_id=v_bot),
    'recebimentos', v_titulos,
    'erp_receber_revenda', (SELECT count(*) FROM erp_receber WHERE company_id=v_bot AND ref_externa_sistema='revenda_veiculos'),
    'procuras', (SELECT count(*) FROM veic_procura WHERE company_id=v_bot),
    'negociacoes', (SELECT count(*) FROM veic_negociacao WHERE company_id=v_bot),
    'por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_veiculo WHERE company_id=v_bot GROUP BY situacao) s),
    'vendas_por_situacao', (SELECT jsonb_object_agg(situacao, n) FROM (SELECT situacao, count(*) n FROM veic_venda WHERE company_id=v_bot GROUP BY situacao) s));
END $function$;

-- Popula na Demo ao aplicar (idempotente, só [BOT] Revenda).
SELECT public.fn_gold_revenda_seed_reparar('b0700000-0000-4000-a000-000000000003');
