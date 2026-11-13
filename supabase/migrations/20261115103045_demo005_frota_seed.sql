-- desenvolvedor_4_g · PDCA aud8 (Controle de frota, DEMO 005 "Indústria Modelo - DEMO"), nota 88/95.
-- GAP 1 (RD-98 p1/p2): a DEMO de indústria não tinha veículo cadastrado, então os 6 KPIs da tela de
-- frota (VEÍCULOS / MANUTENÇÃO VENCIDA / DOCUMENTOS VENCIDOS / CUSTO TOTAL / CUSTO POR KM / CONSUMO
-- MÉDIO) ficavam zerados e a jornada de inclusão/edição/custo real da frota não era verificável.
--
-- Esta migration SÓ cria um seed FICTÍCIO (RD-69) para a empresa DEMO 005 e o liga ao fn_demo_reset,
-- para a frota sobreviver ao reset da demo. NÃO toca o componente compartilhado com o Hub, nem
-- permissão/RLS/função de guarda (RD-35). Aditiva e idempotente (delete das próprias linhas da DEMO
-- + insert). Trava dupla: só executa para o id fixo da DEMO 005 e só se companies.is_demo = true.
--
-- Fonte dos KPIs (fn_hub_frota_indicadores): km percorrido e litros vêm de erp_viagem /
-- erp_viagem_lancamento (abastecimento), casados pela placa; custo de manutenção de erp_hub_frota_custo;
-- manutenção vencida de erp_hub_frota_manutencao_plano; documentos vencidos de erp_hub_frota_documento.
--
-- Prova RD-38 (produção, antes): empresa 005 is_demo=true; erp_hub_frota_veiculo(005)=0; erp_viagem(005)=0.
-- Prova RD-38 (depois do seed): 3 veículos, 1 manutenção vencida, 1 documento vencido,
--   CUSTO TOTAL = R$ 12.110, CONSUMO MÉDIO ≈ 4,95 km/L, CUSTO POR KM ≈ R$ 2,63.

-- 1) Seed FICTÍCIO da frota da DEMO 005 (idempotente, travado em is_demo).
-- ci-sem-guarda: fn_demo_seed_industria_frota — seed de manutenção da DEMO, não é escrita por usuário: trava
-- hard no ÚNICO tenant DEMO de indústria (p_company_id = c fixo; só companies.is_demo) e é chamada só pelo
-- fn_demo_reset (service_role); nenhum company_id de registro vem do chamador, logo não há empresa a conferir.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_frota(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c  constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v1 uuid; v2 uuid; v3 uuid;  -- veículos
  g1 uuid; g2 uuid; g3 uuid;  -- viagens
BEGIN
  -- trava: só a DEMO de indústria
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- delete físico liberado SÓ nesta transação e SÓ nas linhas da demo (idempotência do reset)
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);

  -- idempotência: zera só o que ESTE seed cria para a DEMO 005
  DELETE FROM public.erp_hub_frota_custo             WHERE company_id = c;
  DELETE FROM public.erp_hub_frota_documento         WHERE company_id = c;
  DELETE FROM public.erp_hub_frota_manutencao_registro WHERE company_id = c;
  DELETE FROM public.erp_hub_frota_manutencao_plano  WHERE company_id = c;
  DELETE FROM public.erp_hub_frota_veiculo           WHERE company_id = c;
  -- viagens/abastecimentos deste seed são identificados pelas placas FICTÍCIAS (exclusivas da demo)
  DELETE FROM public.erp_viagem_lancamento           WHERE company_id = c AND placa IN ('DEM1A01','DEM2B02','DEM3C03');
  DELETE FROM public.erp_viagem                      WHERE company_id = c AND placa IN ('DEM1A01','DEM2B02','DEM3C03');

  -- ===== Veículos (placas e marca/modelo GENÉRICOS e FICTÍCIOS) =====
  INSERT INTO public.erp_hub_frota_veiculo
    (company_id, placa, modelo, marca, ano, tipo, km_inicial, combustivel, valor_aquisicao, data_entrada, observacao, ativo)
  VALUES (c, 'DEM1A01', 'Furgão frigorífico 4x2', 'Genérica', 2021, 'caminhao', 182000, 'diesel', 320000, current_date - 900, 'Veículo FICTÍCIO (demonstração)', true)
  RETURNING id INTO v1;
  INSERT INTO public.erp_hub_frota_veiculo
    (company_id, placa, modelo, marca, ano, tipo, km_inicial, combustivel, valor_aquisicao, data_entrada, observacao, ativo)
  VALUES (c, 'DEM2B02', 'Furgão de entrega', 'Genérica', 2022, 'caminhao', 96000, 'diesel', 165000, current_date - 540, 'Veículo FICTÍCIO (demonstração)', true)
  RETURNING id INTO v2;
  INSERT INTO public.erp_hub_frota_veiculo
    (company_id, placa, modelo, marca, ano, tipo, km_inicial, combustivel, valor_aquisicao, data_entrada, observacao, ativo)
  VALUES (c, 'DEM3C03', 'Caminhonete cabine dupla', 'Genérica', 2023, 'caminhonete', 60500, 'diesel', 198000, current_date - 300, 'Veículo FICTÍCIO (demonstração)', true)
  RETURNING id INTO v3;

  -- ===== Planos de manutenção (1 vencido, 1 verde, 1 amarelo) =====
  -- V1: proxima_km = 174000+10000 = 184000 <= km_atual 184600 -> VENCIDO (vermelho)
  INSERT INTO public.erp_hub_frota_manutencao_plano (company_id, veiculo_id, tipo, intervalo_km, ultimo_km, observacao)
  VALUES (c, v1, 'Troca de óleo e filtros', 10000, 174000, 'Plano FICTÍCIO (demonstração)');
  -- V2: proxima_km = 90000+10000 = 100000, km_atual 97200 -> faltam 2800 > 20% -> verde
  INSERT INTO public.erp_hub_frota_manutencao_plano (company_id, veiculo_id, tipo, intervalo_km, ultimo_km, observacao)
  VALUES (c, v2, 'Revisão preventiva', 10000, 90000, 'Plano FICTÍCIO (demonstração)');
  -- V3: proxima_km = 52500+10000 = 62500, km_atual 61300 -> faltam 1200 <= 20% -> amarelo
  INSERT INTO public.erp_hub_frota_manutencao_plano (company_id, veiculo_id, tipo, intervalo_km, ultimo_km, observacao)
  VALUES (c, v3, 'Rodízio de pneus', 10000, 52500, 'Plano FICTÍCIO (demonstração)');

  -- Registro de manutenção já feita (histórico) do V1
  INSERT INTO public.erp_hub_frota_manutencao_registro (company_id, veiculo_id, tipo, data, km_na_manutencao, valor, fornecedor, descricao)
  VALUES (c, v1, 'Troca de óleo e filtros', current_date - 45, 174000, 1800, 'Oficina de Demonstração', 'Manutenção FICTÍCIA (demonstração)');

  -- ===== Custos de manutenção (feed de CUSTO TOTAL) =====
  INSERT INTO public.erp_hub_frota_custo (company_id, veiculo_id, categoria, descricao, valor, fornecedor_nome, data_custo)
  VALUES
    (c, v1, 'manutencao', 'Revisão + troca de óleo', 1800, 'Oficina de Demonstração', current_date - 45),
    (c, v1, 'pneu',       'Jogo de pneus',          1200, 'Oficina de Demonstração', current_date - 20),
    (c, v2, 'manutencao', 'Revisão preventiva',      900, 'Oficina de Demonstração', current_date - 30),
    (c, v3, 'manutencao', 'Alinhamento e balanceamento', 600, 'Oficina de Demonstração', current_date - 15);

  -- ===== Documentos (1 vencido, 1 amarelo, 1 verde) =====
  INSERT INTO public.erp_hub_frota_documento (company_id, veiculo_id, tipo, vencimento, valor, observacao)
  VALUES
    (c, v1, 'licenciamento', current_date - 20,  180, 'Documento FICTÍCIO (demonstração)'),  -- vencido
    (c, v3, 'licenciamento', current_date + 15,  180, 'Documento FICTÍCIO (demonstração)'),  -- amarelo
    (c, v2, 'seguro',        current_date + 180, 2400, 'Documento FICTÍCIO (demonstração)'); -- verde

  -- ===== Viagens (km percorrido por placa, feed de CUSTO POR KM) =====
  -- origem_registro restrito a {administrativo,campo,planilha}; vínculo exige obra_id OU carga (uso: carga).
  INSERT INTO public.erp_viagem (company_id, numero, colaborador_nome, placa, periodo_inicio, periodo_fim, origem, destino, km_inicial, km_final, adiantamento, status, origem_registro, carga, fechada_em, observacao)
  VALUES (c, 9001, 'Motorista Demonstração 1', 'DEM1A01', current_date - 10, current_date - 9, 'Centro de distribuição', 'Clientes (rota)', 182000, 184600, 0, 'fechada', 'administrativo', 'Carga refrigerada (demonstração)', now(), 'Viagem FICTÍCIA (demonstração)')
  RETURNING id INTO g1;
  INSERT INTO public.erp_viagem (company_id, numero, colaborador_nome, placa, periodo_inicio, periodo_fim, origem, destino, km_inicial, km_final, adiantamento, status, origem_registro, carga, fechada_em, observacao)
  VALUES (c, 9002, 'Motorista Demonstração 2', 'DEM2B02', current_date - 8, current_date - 8, 'Centro de distribuição', 'Clientes (rota)', 96000, 97200, 0, 'fechada', 'administrativo', 'Entregas (demonstração)', now(), 'Viagem FICTÍCIA (demonstração)')
  RETURNING id INTO g2;
  INSERT INTO public.erp_viagem (company_id, numero, colaborador_nome, placa, periodo_inicio, periodo_fim, origem, destino, km_inicial, km_final, adiantamento, status, origem_registro, carga, fechada_em, observacao)
  VALUES (c, 9003, 'Motorista Demonstração 3', 'DEM3C03', current_date - 6, current_date - 6, 'Centro de distribuição', 'Clientes (rota)', 60500, 61300, 0, 'fechada', 'administrativo', 'Apoio operacional (demonstração)', now(), 'Viagem FICTÍCIA (demonstração)')
  RETURNING id INTO g3;

  -- ===== Abastecimentos (litros + custo de combustível, feed de CONSUMO MÉDIO) =====
  INSERT INTO public.erp_viagem_lancamento (company_id, viagem_id, tipo, data, fornecedor_nome, categoria, descricao, forma_pagamento, pago_colaborador, valor, placa, hodometro, litros, tanque_cheio, origem_registro, carga, rateio)
  VALUES
    (c, g1, 'abastecimento', current_date - 10, 'Posto de Demonstração', 'combustivel', 'Abastecimento', 'cartao_empresa', false, 3100, 'DEM1A01', 183200, 360, true, 'administrativo', 'Carga refrigerada (demonstração)', false),
    (c, g1, 'abastecimento', current_date - 9,  'Posto de Demonstração', 'combustivel', 'Abastecimento', 'cartao_empresa', false, 2900, 'DEM1A01', 184600, 340, true, 'administrativo', 'Carga refrigerada (demonstração)', false),
    (c, g2, 'abastecimento', current_date - 8,  'Posto de Demonstração', 'combustivel', 'Abastecimento', 'cartao_empresa', false, 1050, 'DEM2B02', 97200, 150, true, 'administrativo', 'Entregas (demonstração)', false),
    (c, g3, 'abastecimento', current_date - 6,  'Posto de Demonstração', 'combustivel', 'Abastecimento', 'cartao_empresa', false,  560, 'DEM3C03', 61300,  80, true, 'administrativo', 'Apoio operacional (demonstração)', false);

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_frota',
    'veiculos',   (SELECT count(*) FROM public.erp_hub_frota_veiculo WHERE company_id = c AND excluido_em IS NULL),
    'planos',     (SELECT count(*) FROM public.erp_hub_frota_manutencao_plano WHERE company_id = c AND excluido_em IS NULL),
    'documentos', (SELECT count(*) FROM public.erp_hub_frota_documento WHERE company_id = c AND excluido_em IS NULL),
    'custos',     (SELECT count(*) FROM public.erp_hub_frota_custo WHERE company_id = c AND excluido_em IS NULL),
    'viagens',    (SELECT count(*) FROM public.erp_viagem WHERE company_id = c AND origem_registro = 'demo_frota' AND excluido_em IS NULL),
    'abastecimentos', (SELECT count(*) FROM public.erp_viagem_lancamento WHERE company_id = c AND origem_registro = 'demo_frota' AND excluido_em IS NULL));
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_frota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_frota(uuid) TO service_role;

-- 2) Liga o seed da frota ao reset da DEMO 005 (mesmo padrão do bloco de postos).
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb;
  v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb; v_fis jsonb; v_dre jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000005'::uuid THEN 'fn_gold_sst_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000006'::uuid THEN 'fn_demo_seed_construtora'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_fin := fn_demo_seed_ge_financeiro(p_company_id);
    v_ban := fn_demo_seed_ge_bancos(p_company_id);
    v_fis := fn_demo_seed_ge_fiscal(p_company_id);
    v_dre := fn_demo_seed_ge_dre(p_company_id);  -- [GE G0-F] Bloco 6: assinatura R$0 + DRE 6 meses
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre);
  END IF;

  -- 02/10: Pauta da P&M com cenário realista (atrasados, vence hoje, aguardando, rodadas)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta', public.fn_demo_seed_pm_pauta(p_company_id));
  END IF;

  -- 02/10 (PM-B): visões salvas da Pauta (link ?visao=)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_visoes', public.fn_demo_seed_pm_visoes(p_company_id));
  END IF;

  -- 02/10 (PM-C): rodadas, aprovações com prazo e motivos de espera da Pauta
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_fluxo', public.fn_demo_seed_pm_fluxo(p_company_id));
  END IF;

  -- 03/10 (Social): planejamento do mês de 2 clientes, posts e os jobs dos aprovados
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('social', public.fn_demo_seed_pm_social(p_company_id));
  END IF;

  -- 02/10 (PM-D): Meu dia — menções com @, anotações e horas de hoje
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_dia', public.fn_demo_seed_pm_dia(p_company_id));
  END IF;

  -- 31/10 (dev7claudeps · PDCA margem-job): serviço/valor/custo nos jobs + fees, para Margem por Serviço e por Fee
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('margem', public.fn_demo_seed_pm_margem(p_company_id));
  END IF;

  -- 07/11 (desenvolvedor_4_g · PDCA /dashboard/pm): a cada reset, reaplica a limpeza dos clientes de
  -- teste (E2E/[BOT]/teste/screenshot SEM job/contrato ativo) para o KPI "Clientes ativos" não voltar
  -- a inflar entre rodadas de E2E. Idempotente e travado em empresa is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('limpeza_clientes_teste', public.fn_demo_pm_limpar_clientes_teste(p_company_id));
  END IF;

  -- 01/11 (PDCA Hub · simulador): simulações salvas reais da construtora DEMO (bloco "Simulações salvas" não fica vazio)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  -- 08/11 (dev7claudeps · RH/Postos genérico, CEO 08/11): quadro de postos do abatedouro FICTÍCIO da DEMO de
  -- indústria (setor → posto → pessoa com CPF manual + custo por posto; postos vazios = vagas). RD-69: tudo FAKE.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
  END IF;

  -- 12/11 (desenvolvedor_4_g · PDCA aud8 Controle de frota, DEMO 005): frota FICTÍCIA (veículos + planos de
  -- manutenção + documentos + custos + viagens/abastecimento) para os 6 KPIs da tela de frota deixarem de
  -- ficar zerados e a jornada de inclusão/edição/custo ser verificável. RD-69: tudo FAKE. Idempotente e is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('frota', public.fn_demo_seed_industria_frota(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
