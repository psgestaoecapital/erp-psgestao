-- Hub · semente da Construtora DEMO, parte 2 (Eng. Chefe 23/10, caixa a6b84b15 item 1): "inclua 2 viagens fictícias e
-- 1 contrato de preços do cliente na Construtora DEMO" — base para a GE das viagens (tela 270) e o HB-C (tela 274).
--
-- 1) fn_demo_seed_construtora_extras(company, etapa) — NOVA, só na 006 e só se is_demo; sem GRANT a usuário.
--    etapa 'limpar' (antes de a semente apagar as obras): apaga as viagens da demo (lançamentos/eventos vão em cascata)
--      e a tabela de preço FIXA da semente (id …0e0001). Viagem com lançamento já ligado ao contas a pagar (pagar_id)
--      NÃO é apagada: a semente para antes (guarda abaixo), como já fazia com NFS-e.
--    etapa 'semear' (depois das obras):
--      • plano de contas da demo: modelo global (só os códigos que faltam) + 2.04.06 "Deslocamento e viagem"
--        (custo de obra). Nunca apaga categoria — a demo hoje não tem nenhuma e a tela de viagens fica sem categoria.
--      • configuração da viagem: combustível na 2.04.06 (só se a demo ainda não tiver configuração).
--      • viagem nº 1 FECHADA (DEMO-OB-001, 3 dias, adiantamento R$ 600,00) e nº 2 ABERTA (DEMO-OB-002, em curso),
--        com despesas e abastecimentos na 2.04.06; a fechada leva o evento 'viagem_fechada' com o resumo oficial
--        (fn_viagem_resumo) — o mesmo que fn_viagem_fechar grava.
--        CONTA (para conferir na tela): viagem 1 = 389,90 + 162,00 + 299,25 + 94,50 + 38,40 = 984,05; pago pelo
--        colaborador = 162,00 + 94,50 + 38,40 = 294,90; saldo = 600,00 − 294,90 = 305,10 (colaborador devolve);
--        km = 45.498 − 45.210 = 288; litros 47,5 + 15,0 = 62,5 → 288 ÷ 62,5 = 4,61 km/l; custo/km = 984,05 ÷ 288 = 3,42.
--        Viagem 2 = 245,00 + 58,70 = 303,70 (em aberto, sem km final).
--      • 1 contrato de preços do cliente "Residencial Vista Verde": forro e drywall por faixa de quantidade,
--        adicional de 20% no noturno e 50% no domingo, código externo do cliente por serviço e preço fixo no domingo
--        do forro. CONTA: forro 150 m² → faixa 100–300 → 92,00 × 150 = 13.800,00; noturno 92,00 × 1,20 = 110,40.
--      Lançamento de viagem NÃO gera título no contas a pagar (pagar_id NULL): isso é a GE das viagens (item 2).
-- 2) fn_demo_seed_construtora: patch por âncora (corpo vigente preservado — RD-69; aborta se a âncora sumir):
--      • a guarda passa a parar só se houver lançamento de viagem ligado ao financeiro (pagar_id) — antes qualquer
--        viagem na obra demo travava o reset para sempre;
--      • chama 'limpar' antes de apagar as obras e 'semear' antes do RETURN.
-- 3) Roda uma vez agora (só se a 006 existir e for demo).
-- RD-55: nenhuma empresa real é tocada. Plano de volta: CREATE OR REPLACE do fn_demo_seed_construtora pelo arquivo
-- 20261023233000 (corpo anterior) e DROP FUNCTION fn_demo_seed_construtora_extras.

-- ci-sem-guarda: fn_demo_seed_construtora_extras — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_seed_construtora (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_extras(p_company_id uuid, p_etapa text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  tp constant uuid := 'b0700000-0000-4000-a000-0000000e0001';
  cat constant text := '2.04.06';
  v_hoje date := current_date;
  v_ob1 uuid; v_ob2 uuid; v_cli uuid; v_v1 uuid; v_v2 uuid; v_pc int := 0;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  IF p_etapa = 'limpar' THEN
    IF EXISTS (SELECT 1 FROM erp_viagem_lancamento WHERE company_id = c AND pagar_id IS NOT NULL) THEN
      RAISE EXCEPTION 'fn_demo_seed_construtora_extras: viagem da demo ligada ao contas a pagar';
    END IF;
    DELETE FROM erp_viagem WHERE company_id = c;
    DELETE FROM erp_tabela_preco_codigo WHERE tabela_id = tp AND company_id = c;
    DELETE FROM erp_tabela_preco_condicao WHERE tabela_id = tp AND company_id = c;
    DELETE FROM erp_tabela_preco_item WHERE tabela_id = tp AND company_id = c;
    DELETE FROM erp_tabela_preco_cliente WHERE id = tp AND company_id = c;
    RETURN jsonb_build_object('ok', true, 'etapa', 'limpar');
  END IF;

  IF p_etapa IS DISTINCT FROM 'semear' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'etapa_invalida');
  END IF;

  -- plano de contas: modelo global + Deslocamento e viagem (só o que falta; nunca apaga)
  INSERT INTO erp_plano_contas (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador, sugerida_global)
  SELECT c, g.codigo, g.descricao, g.grupo, g.tipo, g.pai_codigo, g.nivel, true, g.is_totalizador, false
    FROM erp_plano_contas g
   WHERE g.company_id IS NULL AND g.ativo
     AND NOT EXISTS (SELECT 1 FROM erp_plano_contas e WHERE e.company_id = c AND e.codigo = g.codigo);
  GET DIAGNOSTICS v_pc = ROW_COUNT;
  INSERT INTO erp_plano_contas (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador, sugerida_global)
  SELECT c, cat, 'Deslocamento e viagem', 'custo', 'custo', '2.04', 3, true, false, false
   WHERE NOT EXISTS (SELECT 1 FROM erp_plano_contas e WHERE e.company_id = c AND e.codigo = cat);
  INSERT INTO erp_viagem_config (company_id, modo, cat_combustivel)
  VALUES (c, 'ambos', cat) ON CONFLICT (company_id) DO NOTHING;

  SELECT id INTO v_ob1 FROM projetos_obras WHERE company_id = c AND numero = 'DEMO-OB-001';
  SELECT id INTO v_ob2 FROM projetos_obras WHERE company_id = c AND numero = 'DEMO-OB-002';
  IF v_ob1 IS NULL OR v_ob2 IS NULL THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora_extras: obras DEMO-OB-001/002 não encontradas';
  END IF;

  -- viagem 1: fechada (há 2 semanas, 3 dias)
  INSERT INTO erp_viagem (company_id, numero, colaborador_nome, placa, obra_id, periodo_inicio, periodo_fim, origem, destino,
                          km_inicial, km_final, adiantamento, status, origem_registro, observacao, fechada_em)
  VALUES (c, 1, 'Carlos Encarregado (Demo)', 'DEM1A01', v_ob1, v_hoje - 16, v_hoje - 14, 'Chapecó', 'Concórdia',
          45210, 45498, 600, 'aberta', 'administrativo', 'Montagem do forro – equipe de 2', NULL)
  RETURNING id INTO v_v1;
  INSERT INTO erp_viagem_lancamento (company_id, viagem_id, tipo, data, fornecedor_nome, documento, tipo_despesa, categoria,
                                     descricao, forma_pagamento, pago_colaborador, valor, obra_id, placa, hodometro, litros,
                                     tanque_cheio, origem_registro)
  VALUES
    (c, v_v1, 'despesa', v_hoje - 16, 'Hotel Rota do Oeste (Demo)', 'NF 1201', 'hospedagem', cat, '2 diárias, quarto duplo',
     'cartao_empresa', false, 389.90, v_ob1, NULL, NULL, NULL, NULL, 'administrativo'),
    (c, v_v1, 'despesa', v_hoje - 15, 'Restaurante Sabor da Serra (Demo)', 'NFC-e 88412', 'alimentacao', cat, 'Almoço e jantar – 2 pessoas',
     'cartao_proprio', true, 162.00, v_ob1, NULL, NULL, NULL, NULL, 'campo'),
    (c, v_v1, 'abastecimento', v_hoje - 14, 'Posto Trevo (Demo)', 'NFC-e 55120', 'combustivel', cat, 'Diesel S10',
     'dinheiro', true, 94.50, v_ob1, 'DEM1A01', 45460, 15.0, false, 'campo'),
    (c, v_v1, 'despesa', v_hoje - 14, 'Pedágio BR-282 (Demo)', NULL, 'pedagio', cat, 'Ida e volta',
     'dinheiro', true, 38.40, v_ob1, NULL, NULL, NULL, NULL, 'campo'),
    (c, v_v1, 'abastecimento', v_hoje - 16, 'Posto Trevo (Demo)', 'NFC-e 55031', 'combustivel', cat, 'Diesel S10 – saída',
     'cartao_empresa', false, 299.25, v_ob1, 'DEM1A01', 45210, 47.5, true, 'administrativo');
  UPDATE erp_viagem SET status = 'fechada', fechada_em = (v_hoje - 13)::timestamptz, atualizado_em = now() WHERE id = v_v1;
  INSERT INTO erp_viagem_evento (company_id, viagem_id, tipo, payload)
  SELECT c, v_v1, 'viagem_fechada', jsonb_build_object(
    'numero', 1, 'colaborador', v.colaborador_nome, 'resumo', fn_viagem_resumo(v_v1),
    'lancamentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'fornecedor', l.fornecedor_nome,
        'categoria', l.categoria, 'valor', l.valor, 'obra_id', l.obra_id, 'forma_pagamento', l.forma_pagamento,
        'pago_colaborador', l.pago_colaborador) ORDER BY l.data)
      FROM erp_viagem_lancamento l WHERE l.viagem_id = v_v1 AND l.excluido_em IS NULL), '[]'::jsonb))
    FROM erp_viagem v WHERE v.id = v_v1;

  -- viagem 2: em curso (aberta)
  INSERT INTO erp_viagem (company_id, numero, colaborador_nome, placa, obra_id, periodo_inicio, periodo_fim, origem, destino,
                          km_inicial, adiantamento, status, origem_registro, observacao)
  VALUES (c, 2, 'Marina Técnica (Demo)', 'DEM2B02', v_ob2, v_hoje - 1, v_hoje + 1, 'Chapecó', 'Xanxerê',
          18730, 400, 'aberta', 'campo', 'Preparo de contrapiso e conferência de medidas')
  RETURNING id INTO v_v2;
  INSERT INTO erp_viagem_lancamento (company_id, viagem_id, tipo, data, fornecedor_nome, documento, tipo_despesa, categoria,
                                     descricao, forma_pagamento, pago_colaborador, valor, obra_id, placa, hodometro, litros,
                                     tanque_cheio, origem_registro)
  VALUES
    (c, v_v2, 'despesa', v_hoje - 1, 'Pousada Xanxerê (Demo)', 'NF 341', 'hospedagem', cat, '1 diária',
     'pix', false, 245.00, v_ob2, NULL, NULL, NULL, NULL, 'campo'),
    (c, v_v2, 'despesa', v_hoje - 1, 'Lanchonete Central (Demo)', 'NFC-e 10233', 'alimentacao', cat, 'Almoço',
     'cartao_proprio', true, 58.70, v_ob2, NULL, NULL, NULL, NULL, 'campo');

  -- contrato de preços do cliente Residencial Vista Verde (id fixo)
  SELECT id INTO v_cli FROM erp_clientes WHERE company_id = c AND nome_fantasia = 'Residencial Vista Verde' LIMIT 1;
  INSERT INTO erp_tabela_preco_cliente (id, company_id, cliente_id, nome, vigencia_inicio, vigencia_fim, moeda, ativo)
  VALUES (tp, c, v_cli, 'Contrato de preços 2026 – Residencial Vista Verde', date_trunc('year', v_hoje)::date,
          (date_trunc('year', v_hoje) + interval '1 year - 1 day')::date, 'BRL', true);
  INSERT INTO erp_tabela_preco_item (company_id, tabela_id, servico_ref, servico_nome, unidade, faixa_de, faixa_ate, preco_base, adicional)
  VALUES (c, tp, 'DEMO-S01', 'Forro de gesso acartonado', 'm2', 0, 100, 98.00, false),
         (c, tp, 'DEMO-S01', 'Forro de gesso acartonado', 'm2', 100, 300, 92.00, false),
         (c, tp, 'DEMO-S01', 'Forro de gesso acartonado', 'm2', 300, NULL, 86.50, false),
         (c, tp, 'DEMO-S02', 'Parede drywall simples', 'm2', 0, 200, 118.00, false),
         (c, tp, 'DEMO-S02', 'Parede drywall simples', 'm2', 200, NULL, 109.00, false);
  INSERT INTO erp_tabela_preco_condicao (company_id, tabela_id, condicao, percentual)
  VALUES (c, tp, 'normal', NULL), (c, tp, 'noturno', 20), (c, tp, 'domingo', 50);
  INSERT INTO erp_tabela_preco_codigo (company_id, tabela_id, servico_ref, condicao, codigo_externo, preco_fixo)
  VALUES (c, tp, 'DEMO-S01', 'normal', 'VV-FOR-01', NULL),
         (c, tp, 'DEMO-S01', 'domingo', 'VV-FOR-01D', 135.00),
         (c, tp, 'DEMO-S02', 'normal', 'VV-DRY-01', NULL);

  RETURN jsonb_build_object('ok', true, 'etapa', 'semear', 'plano_contas_inseridas', v_pc,
    'viagens', (SELECT count(*) FROM erp_viagem WHERE company_id = c),
    'lancamentos_viagem', (SELECT count(*) FROM erp_viagem_lancamento WHERE company_id = c),
    'tabela_preco_itens', (SELECT count(*) FROM erp_tabela_preco_item WHERE tabela_id = tp));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_extras(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_extras(uuid, text) TO service_role;

-- a semente principal passa a limpar/semear as viagens e a tabela de preço (patch por âncora, corpo vigente — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'fn_demo_seed_construtora_extras' THEN RETURN; END IF;
  v_new := replace(v_def,
    E'     OR EXISTS (SELECT 1 FROM erp_viagem WHERE obra_id IN (SELECT id FROM projetos_obras WHERE company_id = c))\n'
    || E'     OR EXISTS (SELECT 1 FROM erp_viagem_lancamento WHERE obra_id IN (SELECT id FROM projetos_obras WHERE company_id = c)) THEN',
    E'     OR EXISTS (SELECT 1 FROM erp_viagem_lancamento WHERE company_id = c AND pagar_id IS NOT NULL) THEN');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da guarda de viagem nao encontrada'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'  DELETE FROM projetos_obra_tarefa_dependencia WHERE company_id = c;',
    E'  PERFORM fn_demo_seed_construtora_extras(c, ''limpar'');\n  DELETE FROM projetos_obra_tarefa_dependencia WHERE company_id = c;');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora da limpeza nao encontrada'; END IF;
  v_def := v_new;
  v_new := replace(v_def,
    E'  RETURN jsonb_build_object(''ok'', true, ''base'', v_base',
    E'  PERFORM fn_demo_seed_construtora_extras(c, ''semear'');\n  RETURN jsonb_build_object(''ok'', true, ''base'', v_base');
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_seed_construtora: ancora do RETURN nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

-- aplica agora (só se a demo existir neste banco)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
