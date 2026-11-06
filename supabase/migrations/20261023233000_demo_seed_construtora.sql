-- Hub · DURABILIDADE da DEMO da Construtora (Eng. Chefe 23/10, caixa 3f18cb72 + 61297941): a irrigação da
-- "Construtora Modelo - DEMO" (b0700000-…-0006) vivia em pedaços (fn_gold_hub_seed_reparar, cronograma, DO-blocks de
-- estoque/BDI/visitas e hotfix de OB-001) e o fn_demo_reset NÃO tinha ramo para a 006 ('sem_seed_para_esta_demo'):
-- no banco de testes e depois de qualquer reset as telas do Hub ficavam zeradas (Cockpit R$ 0,00) e o auditor reprovava.
--
-- 1) fn_demo_seed_construtora(company) — NOVA, determinística e auto-resetável. Só age na 006 e só se is_demo.
--    Zera o Hub da demo (ordem das FKs, sempre WHERE company_id = c) e recria, em TODAS as obras DEMO-OB-001..004:
--      • base: insumos, mão de obra, serviços com BOM, clientes, oportunidades, obras + itens  (fn_gold_hub_seed_reparar)
--      • cronograma com dependências e LINHA DE BASE                                         (fn_gold_hub_cronograma_seed_reparar)
--      • apontamentos de mão de obra (função do cadastro, custo/h com encargos = custo_hora × (1 + encargos/100))
--      • orçamento aprovado por obra (itens = serviços do catálogo, preço = custo × 1,35) ligado à obra e à oportunidade,
--        e 1 orçamento ENVIADO para a oportunidade em proposta
--      • plantas de takeoff confirmadas com ambientes (área/perímetro/pé-direito → serviço)
--      • visitas da agenda, estoque da calculadora (DEMO-CALC-*) e BDI da configuração (idempotentes)
--    FÓRMULAS (para conferir na tela — critério 4 do Gold):
--      valor_previsto  = Σ itens (quantidade_contratada × preco_unitario)              = total do orçamento aprovado
--      valor_medido    = Σ itens (quantidade_medida × preco_unitario)                   (fn_obra_recalcular_medido)
--      custo_realizado = Σ itens (quantidade_medida × custo de material do serviço) + Σ apontamentos.valor
--    Centro de custo: a obra volta com o mesmo número → o gatilho reaproveita o centro DEMO-OB-00x do GE (não duplica).
--    Lançamentos financeiros (erp_pagar/NFS-e) ficam FORA: o financeiro bloqueia apagar físico — fatia própria, revisada.
-- 2) fn_demo_reset: ramo da 006 → fn_demo_seed_construtora (patch por âncora, corpo vigente preservado — RD-69).
-- 3) Roda uma vez agora na produção (só se a 006 existir e for demo).
-- RD-55: nenhuma empresa real é tocada. Plano de volta: SELECT fn_demo_seed_construtora(...) é idempotente; para tirar
-- o ramo, CREATE OR REPLACE do fn_demo_reset sem a linha WHEN …0006.

-- ci-sem-guarda: fn_demo_seed_construtora — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  v_hoje date := current_date;
  v_base jsonb; v_crono jsonb;
  v_obra record; v_orc uuid; v_pl uuid; v_n_apont int := 0; v_n_orc int := 0; v_n_pl int := 0;
  v_mo uuid[]; v_srv uuid[];
  k int;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_hub');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;
  -- fiscal/viagem ligados a obra não são apagados por seed: se existirem, para sem mexer em nada
  IF EXISTS (SELECT 1 FROM erp_nfse_emitidas WHERE obra_id IN (SELECT id FROM projetos_obras WHERE company_id = c))
     OR EXISTS (SELECT 1 FROM erp_nfse_obra_medicao WHERE obra_id IN (SELECT id FROM projetos_obras WHERE company_id = c))
     OR EXISTS (SELECT 1 FROM erp_viagem WHERE obra_id IN (SELECT id FROM projetos_obras WHERE company_id = c))
     OR EXISTS (SELECT 1 FROM erp_viagem_lancamento WHERE obra_id IN (SELECT id FROM projetos_obras WHERE company_id = c)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'obra_demo_com_fiscal_ou_viagem');
  END IF;

  -- zera o que depende das obras/oportunidades/orçamentos da demo (ordem das FKs)
  DELETE FROM projetos_obra_tarefa_dependencia WHERE company_id = c;
  DELETE FROM projetos_obra_os WHERE company_id = c;
  DELETE FROM projetos_obra_tarefa WHERE company_id = c;
  DELETE FROM projetos_obra_mao_obra_apontamento WHERE company_id = c;
  DELETE FROM projetos_obra_rateio WHERE company_id = c;
  DELETE FROM erp_obra_planta_ambiente WHERE company_id = c;
  DELETE FROM erp_obra_planta WHERE company_id = c;
  DELETE FROM projetos_obra_item WHERE company_id = c;
  DELETE FROM projetos_obras WHERE company_id = c;
  DELETE FROM erp_crm_visita WHERE company_id = c;
  UPDATE erp_crm_lead SET oportunidade_id = NULL WHERE company_id = c AND oportunidade_id IS NOT NULL;
  DELETE FROM erp_crm_oportunidade WHERE company_id = c;
  DELETE FROM erp_orcamentos WHERE company_id = c;

  v_base := fn_gold_hub_seed_reparar(c);
  IF COALESCE((v_base->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora: base falhou %', v_base;
  END IF;
  v_crono := fn_gold_hub_cronograma_seed_reparar(c);

  SELECT array_agg(id ORDER BY codigo) INTO v_mo FROM projetos_mao_obra WHERE company_id = c AND codigo LIKE 'DEMO-M%';
  SELECT array_agg(id ORDER BY codigo) INTO v_srv FROM projetos_servicos WHERE company_id = c AND codigo LIKE 'DEMO-S%';

  FOR v_obra IN
    SELECT o.id, o.numero, o.nome, o.cliente_id, o.cliente_nome, o.oportunidade_id, o.status,
           COALESCE(o.data_inicio, v_hoje - 30) AS ini, COALESCE(o.data_conclusao, v_hoje) AS ate,
           row_number() OVER (ORDER BY o.numero) AS n
      FROM projetos_obras o WHERE o.company_id = c AND o.numero LIKE 'DEMO-OB-%' ORDER BY o.numero
  LOOP
    -- apontamentos: 1 por semana desde o início (até hoje ou a conclusão), função em rodízio
    FOR k IN 0..7 LOOP
      EXIT WHEN v_obra.ini + k * 7 > v_obra.ate;
      INSERT INTO projetos_obra_mao_obra_apontamento (company_id, obra_id, data, funcao_id, descricao, horas, custo_hora)
      SELECT c, v_obra.id, v_obra.ini + k * 7, m.funcao_id,
             m.funcao || ' — ' || (ARRAY['mobilização e marcação','estrutura e perfis','fechamento','acabamento'])[(k % 4) + 1],
             CASE WHEN k % 2 = 0 THEN 16 ELSE 8 END,
             round(m.custo_hora * (1 + COALESCE(m.encargos_pct, 0) / 100.0), 2)
        FROM projetos_mao_obra m WHERE m.id = v_mo[(k % array_length(v_mo, 1)) + 1];
      v_n_apont := v_n_apont + 1;
    END LOOP;

    -- orçamento aprovado da obra (rascunho → itens → aprovado; a obra já aponta para ele, então o gatilho não cria outra)
    INSERT INTO erp_orcamentos (company_id, numero, cliente_id, cliente_nome, data_emissao, data_validade, status,
                                eh_obra, obra_id, obra_cidade, obra_uf, vendedor_nome, condicao_pagamento, observacoes)
    VALUES (c, 'DEMO-ORC-00' || v_obra.n, v_obra.cliente_id, v_obra.cliente_nome, v_obra.ini - 12, v_obra.ini + 18,
            'rascunho', true, v_obra.id, 'Chapecó', 'SC', 'Responsável Demo', 'Medição mensal', v_obra.nome)
    RETURNING id INTO v_orc;
    UPDATE projetos_obras SET orcamento_id = v_orc WHERE id = v_obra.id;
    INSERT INTO erp_orcamentos_itens (orcamento_id, company_id, ordem, tipo_item, servico_id, servico_codigo, servico_descricao,
                                      produto_nome, unidade, quantidade, preco_unitario, preco_custo, subtotal,
                                      bdi_percentual, margem_percentual)
    SELECT v_orc, c, i.ordem, 'servico', s.id, s.codigo, s.nome, s.nome, i.unidade, i.quantidade_contratada,
           i.preco_unitario, i.custo_unitario_previsto, round(i.quantidade_contratada * i.preco_unitario, 2),
           i.bdi_percentual,
           CASE WHEN i.preco_unitario > 0 THEN round((i.preco_unitario - i.custo_unitario_previsto) / i.preco_unitario * 100, 2) END
      FROM projetos_obra_item i JOIN projetos_servicos s ON s.id = i.servico_id
     WHERE i.obra_id = v_obra.id ORDER BY i.ordem;
    UPDATE projetos_obra_item i SET orcamento_item_id = oi.id
      FROM erp_orcamentos_itens oi WHERE oi.orcamento_id = v_orc AND oi.servico_id = i.servico_id AND oi.ordem = i.ordem
       AND i.obra_id = v_obra.id;
    UPDATE erp_orcamentos SET status = 'aprovado', data_aprovacao = (v_obra.ini - 3)::timestamptz WHERE id = v_orc;
    IF v_obra.oportunidade_id IS NOT NULL THEN
      UPDATE erp_crm_oportunidade o SET orcamento_id = v_orc, valor_proposta = r.total
        FROM erp_orcamentos r WHERE r.id = v_orc AND o.id = v_obra.oportunidade_id;
    END IF;
    v_n_orc := v_n_orc + 1;

    -- números da obra coerentes com os itens e os apontamentos (fórmulas no cabeçalho)
    UPDATE projetos_obras o SET
      valor_previsto = COALESCE((SELECT round(sum(i.quantidade_contratada * i.preco_unitario), 2)
                                   FROM projetos_obra_item i WHERE i.obra_id = o.id AND i.excluido_em IS NULL), 0),
      custo_realizado = COALESCE((SELECT round(sum(i.quantidade_medida * s.custo_material), 2)
                                    FROM projetos_obra_item i JOIN projetos_servicos s ON s.id = i.servico_id
                                   WHERE i.obra_id = o.id AND i.excluido_em IS NULL), 0)
                      + COALESCE((SELECT sum(a.valor) FROM projetos_obra_mao_obra_apontamento a
                                   WHERE a.obra_id = o.id AND a.excluido_em IS NULL), 0)
     WHERE o.id = v_obra.id;
    PERFORM fn_obra_recalcular_medido(v_obra.id);

    -- planta de takeoff confirmada nas 2 primeiras obras
    IF v_obra.n <= 2 THEN
      INSERT INTO erp_obra_planta (company_id, orcamento_id, nome, arquivo_path, arquivo_tipo, escala_informada, status,
                                   projeto_nome, cliente_nome, cliente_id, obra_cidade, obra_uf, data_projeto,
                                   engenheiro_responsavel, ia_resumo, analisado_em)
      VALUES (c, v_orc, 'Planta baixa – ' || v_obra.nome, 'demo/plantas/' || v_obra.numero || '.pdf', 'pdf', '1:50',
              'confirmada', v_obra.nome, v_obra.cliente_nome, v_obra.cliente_id, 'Chapecó', 'SC', v_obra.ini - 20,
              'Eng. Responsável Demo', jsonb_build_object('origem', 'demo', 'ambientes', 3), now())
      RETURNING id INTO v_pl;
      INSERT INTO erp_obra_planta_ambiente (company_id, planta_id, nome, largura_m, comprimento_m, area_m2, perimetro_ml,
                                            pe_direito_m, confianca, origem, confirmado, servico_id, base_calculo)
      SELECT c, v_pl, a.nome, a.l, a.cmp, round(a.l * a.cmp, 2), round(2 * (a.l + a.cmp), 2), 2.70,
             a.conf, 'ia', true, v_srv[a.srv], a.base
        FROM (VALUES ('Sala', 5.20::numeric, 6.00::numeric, 'alta', v_obra.n::int, 'area'),
                     ('Recepção', 3.80, 4.50, 'alta', v_obra.n::int, 'area'),
                     ('Divisória administrativo', 4.00, 0.10, 'media', 2, 'pe_direito_parede')) AS a(nome, l, cmp, conf, srv, base);
      UPDATE erp_obra_planta p SET area_total_m2 = (SELECT sum(area_m2) FROM erp_obra_planta_ambiente WHERE planta_id = p.id)
       WHERE p.id = v_pl;
      v_n_pl := v_n_pl + 1;
    END IF;
  END LOOP;

  -- orçamento ENVIADO da oportunidade em proposta (sem obra ainda)
  INSERT INTO erp_orcamentos (company_id, numero, cliente_id, cliente_nome, data_emissao, data_validade, status, eh_obra,
                              obra_cidade, obra_uf, vendedor_nome, condicao_pagamento, observacoes)
  SELECT c, 'DEMO-ORC-005', o.cliente_id, cl.nome_fantasia, v_hoje - 5, v_hoje + 25, 'enviado', true, 'Chapecó', 'SC',
         'Responsável Demo', 'Medição mensal', o.titulo
    FROM erp_crm_oportunidade o LEFT JOIN erp_clientes cl ON cl.id = o.cliente_id
   WHERE o.company_id = c AND o.etapa = 'proposta_enviada' ORDER BY o.titulo LIMIT 1
  RETURNING id INTO v_orc;
  IF v_orc IS NOT NULL THEN
    INSERT INTO erp_orcamentos_itens (orcamento_id, company_id, ordem, tipo_item, servico_id, servico_codigo, servico_descricao,
                                      produto_nome, unidade, quantidade, preco_unitario, preco_custo, subtotal,
                                      bdi_percentual, margem_percentual)
    SELECT v_orc, c, q.ordem, 'servico', s.id, s.codigo, s.nome, s.nome, s.unidade, q.qtd,
           round(s.custo_unitario_total * 1.35, 2), s.custo_unitario_total, round(q.qtd * round(s.custo_unitario_total * 1.35, 2), 2),
           20, round((round(s.custo_unitario_total * 1.35, 2) - s.custo_unitario_total) / NULLIF(round(s.custo_unitario_total * 1.35, 2), 0) * 100, 2)
      FROM (VALUES (1, 3, 180::numeric), (2, 4, 420::numeric)) AS q(ordem, srv, qtd)
      JOIN projetos_servicos s ON s.id = v_srv[q.srv];
    UPDATE erp_crm_oportunidade o SET orcamento_id = v_orc, valor_proposta = r.total
      FROM erp_orcamentos r WHERE r.id = v_orc AND o.company_id = c AND o.etapa = 'proposta_enviada';
    v_n_orc := v_n_orc + 1;
  END IF;

  -- visitas da agenda (ids fixos; oportunidade pelo título — os ids das oportunidades mudam a cada reset)
  INSERT INTO erp_crm_visita (id, company_id, oportunidade_id, data_visita, status, endereco, anotacoes, responsavel_nome)
  SELECT v.id::uuid, c, o.id, now() + v.delta, v.st, v.ender, v.nota, 'Equipe DEMO'
    FROM (VALUES
      ('b0700000-0000-4000-a000-0000000d0101', 'Forro e divisórias – Residencial Vista Verde', interval '-6 days', 'realizada', 'Rua das Acácias, 120 - Vista Verde', 'Medidas conferidas; forro em 3 ambientes e divisória na sala.'),
      ('b0700000-0000-4000-a000-0000000d0102', 'Piso e pintura – Clínica Bem Viver', interval '-2 days', 'realizada', 'Av. Central, 450 - Clínica Bem Viver', 'Piso com preparo de contrapiso; pintura em duas demãos.'),
      ('b0700000-0000-4000-a000-0000000d0103', 'Drywall sala comercial – Horizonte', interval '2 days', 'agendada', 'Rua do Comércio, 77 - Horizonte', 'Levar trena a laser; confirmar pé-direito.'),
      ('b0700000-0000-4000-a000-0000000d0104', 'Reforma loja – Mercado Central', interval '-9 days', 'cancelada', 'Praça do Mercado, 10 - Mercado Central', 'Cliente remarcou; reagendar.')
    ) AS v(id, titulo, delta, st, ender, nota)
    JOIN erp_crm_oportunidade o ON o.company_id = c AND o.titulo = v.titulo
  ON CONFLICT (id) DO NOTHING;

  -- estoque da calculadora (DEMO-CALC-*) e BDI: só cria o que falta (não são apagados no reset)
  INSERT INTO erp_produtos (company_id, codigo, nome, unidade, preco_custo, preco_custo_medio, ativo)
  SELECT c, 'DEMO-CALC-' || upper(t.chave), t.nome, t.unidade, t.custo, t.custo, true
    FROM (VALUES
      ('chapa','Chapa de gesso standard 12,5 mm','chapa',38.50), ('guia','Guia 48 mm (barra 3 m)','barra',14.20),
      ('montante','Montante 48 mm (barra 3 m)','barra',16.80), ('banda','Banda acústica (rolo 10 m)','rolo',21.00),
      ('la','Lã mineral (rolo)','rolo',96.00), ('parafuso','Parafuso PPA25 (cento)','cento',14.90),
      ('parafuso_ppa35','Parafuso PPA35 (cento)','cento',18.90), ('massa','Massa para junta (balde 5 kg)','balde',32.00),
      ('fita','Fita para junta (rolo)','rolo',12.50), ('perfil_f530','Perfil F530 (barra 3 m)','barra',11.40),
      ('tabica','Tabica (barra 3 m)','barra',12.90), ('pendural','Pendural','un',1.20), ('tirante','Tirante','un',2.10),
      ('uniao','União F530','un',0.95), ('ppa25','Parafuso PPA25 forro (cento)','cento',14.90),
      ('pfm13','Parafuso PFM13 (cento)','cento',16.40), ('nervura','Nervura forro aramado','un',18.30),
      ('juncao_h','Junção H','un',0.80), ('arame','Arame nº 18 (kg)','kg',19.00), ('gesso_cola','Gesso cola (saco 40 kg)','saco',27.00)
    ) AS t(chave, nome, unidade, custo)
   WHERE NOT EXISTS (SELECT 1 FROM erp_produtos p WHERE p.company_id = c AND p.codigo = 'DEMO-CALC-' || upper(t.chave));
  INSERT INTO erp_calc_depara (company_id, sistema, chave, produto_id)
  SELECT c, s.sistema, k.chave, p.id
    FROM unnest(ARRAY['parede','parede_separativa','parede_corta_fogo','revestimento_estruturado','revestimento_colado','forro_aramado','forro_f530']) AS s(sistema)
    CROSS JOIN LATERAL unnest(CASE s.sistema
        WHEN 'forro_f530' THEN ARRAY['chapa','perfil_f530','tabica','pendural','tirante','uniao','ppa25','pfm13','massa','fita']
        WHEN 'forro_aramado' THEN ARRAY['chapa','nervura','juncao_h','arame','gesso_cola','massa','fita']
        WHEN 'revestimento_colado' THEN ARRAY['chapa','gesso_cola','massa','fita']
        ELSE ARRAY['chapa','guia','montante','banda','la','parafuso','parafuso_ppa35','massa','fita'] END) AS k(chave)
    JOIN erp_produtos p ON p.company_id = c AND p.codigo = 'DEMO-CALC-' || upper(k.chave)
  ON CONFLICT (company_id, sistema, chave) DO NOTHING;
  INSERT INTO projetos_modulo_config (company_id, bdi_total_pct)
  SELECT c, 28.50 WHERE NOT EXISTS (SELECT 1 FROM projetos_modulo_config WHERE company_id = c);

  RETURN jsonb_build_object('ok', true, 'base', v_base, 'cronograma', v_crono,
    'apontamentos', v_n_apont, 'orcamentos', v_n_orc, 'plantas', v_n_pl,
    'visitas', (SELECT count(*) FROM erp_crm_visita WHERE company_id = c));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora(uuid) TO service_role;

-- o reset da demo passa a irrigar a Construtora (patch por âncora, corpo vigente preservado — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_reset(uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_demo_seed_construtora' THEN
    v_new := replace(v_def,
      E'    WHEN ''b0700000-0000-4000-a000-000000000005''::uuid THEN ''fn_gold_sst_seed_reparar''\n',
      E'    WHEN ''b0700000-0000-4000-a000-000000000005''::uuid THEN ''fn_gold_sst_seed_reparar''\n'
      || E'    WHEN ''b0700000-0000-4000-a000-000000000006''::uuid THEN ''fn_demo_seed_construtora''\n');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_reset: ancora do ramo SST nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

-- aplica agora (só se a demo existir neste banco)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    PERFORM public.fn_demo_seed_construtora('b0700000-0000-4000-a000-000000000006');
  END IF;
END $$;
