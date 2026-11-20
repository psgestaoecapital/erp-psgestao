-- EHS-0 · DEMO EHS "EHS Modelo - DEMO" (b0700000-0000-4000-a000-00000000000b)
-- CEO 20/11 16:40: criar as telas com DADOS AUDITÁVEIS na EHS Demo, como nas outras verticais.
--
-- A empresa 00b (plano v15_compliance) foi criada vazia; as 24 telas /dashboard/ehs/* não têm
-- o que mostrar. As sementes da DEMO SST/EHS (005) cravavam a empresa na função e ignoravam o
-- parâmetro. Esta migration GENERALIZA três sementes para honrar p_company_id (mantendo a trava
-- is_demo; a 005 continua idêntica, chamada com o id dela) e WIRE o ramo da 00b no fn_demo_reset:
-- seed SST base + postos + matrizes EHS (risco/EPI/treino) + quadro de RH. Sem frota nem nada fora
-- do EHS (o plano da 00b é só Compliance).
--
-- RD-69/LGPD: 100% dado FICTÍCIO; trava is_demo em TODAS as funções; só toca empresa demo.
-- RD-52: arquivo + PR (nunca via MCP). Idempotente: fn_demo_reset recria tudo por empresa.
-- Prova pós-publicação: SELECT fn_demo_reset('b0700000-0000-4000-a000-00000000000b'); + contagem.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) fn_gold_sst_seed_reparar — generalizada (005 e 00b)
-- ─────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_gold_sst_seed_reparar — seed de DEMO, trava is_demo + company fixa (005/00b) no topo
CREATE OR REPLACE FUNCTION public.fn_gold_sst_seed_reparar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c        uuid := p_company_id;   -- generalizada: 005 (DEMO SST indústria) e 00b (DEMO EHS)
  v_robo   constant uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_hoje   date := current_date;
  v_planta uuid; v_prest uuid; v_func uuid; v_cat uuid; v_ficha uuid; v_tipo uuid; v_turma uuid;
  v_setor_ids uuid[] := '{}'; v_funcs uuid[] := '{}'; v_epis uuid[] := '{}';
  v_i int; v_j int; v_cpf text; v_setor int; v_val date;
  v_setores text[] := ARRAY['Abate','Desossa','Embalagem','Câmara Fria','Manutenção','Administrativo'];
  v_slugs   text[] := ARRAY['abate','desossa','embalagem','camara-fria','manutencao','administrativo'];
  v_cargos  text[] := ARRAY['Operador de abate','Desossador','Auxiliar de embalagem','Operador de câmara fria',
                            'Mecânico de manutenção','Técnico de segurança do trabalho'];
  v_nomes   text[] := ARRAY['Ana Paula Demo','Bruno Carvalho Demo','Carla Mendes Demo','Diego Rocha Demo',
    'Elaine Souza Demo','Fábio Lima Demo','Gabriela Nunes Demo','Hugo Martins Demo','Isabela Costa Demo',
    'João Pedro Demo','Karina Alves Demo','Lucas Ferreira Demo','Mariana Duarte Demo','Nelson Pires Demo',
    'Olívia Ramos Demo','Paulo Teixeira Demo','Queila Barbosa Demo','Rafael Gomes Demo','Sabrina Lopes Demo',
    'Tiago Moreira Demo','Úrsula Freitas Demo','Vinícius Castro Demo','Wanda Ribeiro Demo','Yuri Batista Demo',
    'Zeca Terceiro Demo','Rita Terceira Demo','Otávio Terceiro Demo'];
  v_epi record;
  n_docs int; n_fichas int;
BEGIN
  IF c IS NULL
     OR c NOT IN ('b0700000-0000-4000-a000-000000000005'::uuid,
                  'b0700000-0000-4000-a000-00000000000b'::uuid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_sst_ehs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- delete físico liberado SÓ nesta transação e SÓ nas linhas da demo (RD-30: manutenção deliberada)
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);

  -- ── 0) zera os dados SST da demo (ordem das FKs) ──
  DELETE FROM bpo_inbox_items WHERE company_id = c AND tipo_origem = 'compliance_vencimento';
  DELETE FROM compliance_epi_assinatura_tokens WHERE company_id = c;
  DELETE FROM epi_assinatura     WHERE company_id = c;
  DELETE FROM epi_alerta         WHERE company_id = c;
  DELETE FROM epi_movimentacao   WHERE company_id = c;
  DELETE FROM epi_ficha          WHERE company_id = c;
  DELETE FROM epi_estoque        WHERE company_id = c;
  DELETE FROM compliance_calendar_tarefas WHERE company_id = c;
  DELETE FROM compliance_documentos       WHERE company_id = c;
  DELETE FROM compliance_exigencia_pessoa WHERE company_id = c;
  DELETE FROM compliance_dispensas        WHERE company_id = c;
  DELETE FROM compliance_documento_exigido WHERE company_id = c;
  DELETE FROM nr_turma_presenca  WHERE company_id = c;
  DELETE FROM nr_turma           WHERE company_id = c;
  DELETE FROM nr_treinamento_tipo WHERE company_id = c;
  DELETE FROM prod_posto_risco   WHERE company_id = c;
  DELETE FROM prod_posto_epi     WHERE company_id = c;
  DELETE FROM prod_posto_pessoa  WHERE company_id = c;
  DELETE FROM prod_posto_turno   WHERE company_id = c;
  DELETE FROM prod_posto_custo   WHERE company_id = c;   -- FK NO ACTION: filho de prod_posto (tabela de 31/10); apagar antes do pai
  DELETE FROM prod_tempo_padrao  WHERE company_id = c;
  DELETE FROM prod_fluxo_etapa   WHERE company_id = c;
  DELETE FROM prod_fluxo         WHERE company_id = c;
  DELETE FROM prod_posto         WHERE company_id = c;
  DELETE FROM prod_setor_vinculo WHERE company_id = c;
  DELETE FROM prod_setor         WHERE company_id = c;
  DELETE FROM nr36_ciencia_mensal       WHERE company_id = c;
  DELETE FROM nr36_funcionario_elegivel WHERE company_id = c;
  DELETE FROM ind_ponto_horas    WHERE company_id = c;
  DELETE FROM ind_ponto_dia      WHERE company_id = c;
  DELETE FROM ind_ponto_colaborador WHERE company_id = c;
  DELETE FROM rh_alocacao        WHERE company_id = c;
  DELETE FROM rh_rv_lancamento_dia WHERE company_id = c;
  DELETE FROM rh_rv_participante WHERE company_id = c;
  DELETE FROM prod_salario_base  WHERE company_id = c;
  DELETE FROM rh_posto_trabalho  WHERE company_id = c;
  DELETE FROM compliance_funcionarios WHERE company_id = c;
  DELETE FROM compliance_prestadores  WHERE company_id = c;
  DELETE FROM compliance_setores      WHERE company_id = c;
  DELETE FROM epi_catalogo            WHERE company_id = c;

  -- ── 1) responsável de compliance = robô (alertas de vencimento nunca vão para um operador real) ──
  INSERT INTO compliance_responsaveis (company_id, user_id, ativo, observacao)
  VALUES (c, v_robo, true, 'Demonstração: alertas da demo ficam com o robô')
  ON CONFLICT (company_id, user_id) DO UPDATE SET ativo = true;
  UPDATE compliance_responsaveis SET ativo = false WHERE company_id = c AND user_id <> v_robo;

  -- ── 2) planta + setores ──
  SELECT id INTO v_planta FROM industrial_plants WHERE company_id = c AND codigo_planta = 'DEMO-SST';
  IF v_planta IS NULL THEN
    INSERT INTO industrial_plants (company_id, nome_planta, codigo_planta, cidade_estado, tipo_inspecao, num_turnos, is_active)
    VALUES (c, 'Planta Demo', 'DEMO-SST', 'Chapecó/SC', 'SIF', 2, true)
    RETURNING id INTO v_planta;
  END IF;

  FOR v_i IN 1..6 LOOP
    INSERT INTO compliance_setores (company_id, nome, slug, descricao, is_global, ativo, ordem_exibicao)
    VALUES (c, v_setores[v_i], v_slugs[v_i], 'Setor da demonstração', false, true, v_i * 10)
    RETURNING id INTO v_func;
    v_setor_ids := v_setor_ids || v_func;
  END LOOP;

  -- 2 setores já importados para o LTCAT (a tela mostra "já cadastrados" e "novos")
  INSERT INTO prod_setor (company_id, plant_id, nome, ordem, ativo)
  VALUES (c, v_planta, 'Abate', 1, true), (c, v_planta, 'Desossa', 2, true);

  -- ── 3) prestador + funcionários ──
  INSERT INTO compliance_prestadores (company_id, razao_social, cnpj, nome_fantasia, responsavel_nome, email, telefone,
     cidade, uf, tipo_contrato, data_contrato_inicio, servico_descricao, classificacao_servico, tipos_servico, ativo)
  VALUES (c, 'Manutenção Industrial Demonstração LTDA', fn_demo_cnpj_valido(555000000101), 'Manutenção Demo',
     'Responsável Demo', 'prestador@demo.local', '(49) 3000-0101', 'Chapecó', 'SC', 'prestacao_servico',
     v_hoje - 400, 'Manutenção de máquinas da linha', 'fixo', ARRAY['manutencao'], true)
  RETURNING id INTO v_prest;

  FOR v_i IN 1..27 LOOP
    v_cpf   := fn_demo_cpf_valido(555000000 + v_i);
    v_setor := CASE WHEN v_i <= 24 THEN ((v_i - 1) % 6) + 1 ELSE 5 END;   -- terceirizados na Manutenção
    INSERT INTO compliance_funcionarios (company_id, nome_completo, cpf, email, telefone, matricula, cargo, funcao,
       setor_id, data_admissao, tipo_contrato, cidade, uf, ativo, vinculo_tipo, prestador_id)
    VALUES (c, v_nomes[v_i], v_cpf, 'func' || v_i || '@demo.local', '(49) 99000-' || lpad(v_i::text, 4, '0'),
       CASE WHEN v_i <= 24 THEN 'D' || lpad(v_i::text, 4, '0') END,
       v_cargos[v_setor], v_cargos[v_setor], v_setor_ids[v_setor], v_hoje - (v_i * 30),
       CASE WHEN v_i <= 24 THEN 'clt' ELSE 'terceirizado' END, 'Chapecó', 'SC', true,
       CASE WHEN v_i <= 24 THEN 'direto' ELSE 'terceirizado' END,
       CASE WHEN v_i <= 24 THEN NULL ELSE v_prest END)
    RETURNING id INTO v_func;
    v_funcs := v_funcs || v_func;

    -- ponto eletrônico (só diretos): colaborador + 5 dias fixos, departamento = setor
    IF v_i <= 24 THEN
      INSERT INTO ind_ponto_colaborador (company_id, plant_id, provider, cpf, matricula, nome, funcao, departamento, admissao)
      VALUES (c, v_planta, 'demo', v_cpf, 'D' || lpad(v_i::text, 4, '0'), v_nomes[v_i], v_cargos[v_setor],
              v_setores[v_setor], v_hoje - (v_i * 30));
      INSERT INTO ind_ponto_dia (company_id, plant_id, cpf, registration_number, data, shift, worked_seconds, department, total_pontos)
      SELECT c, v_planta, v_cpf, 'D' || lpad(v_i::text, 4, '0'), d::date, 'Turno A', 8 * 3600, v_setores[v_setor], 4
      FROM generate_series(date '2026-09-01', date '2026-09-05', interval '1 day') d;
    END IF;
  END LOOP;

  -- ── 4) matriz de conformidade ──
  -- terceirizados: exigência ASO + NR-06 (sem isto eles não aparecem na matriz)
  INSERT INTO compliance_documento_exigido (company_id, tipo_documento_id, aplica_a, obrigatorio, ativo)
  SELECT c, t.id, 'funcionario_terceiro', true, true
  FROM compliance_tipos_documento t WHERE t.slug IN ('aso','nr06');

  FOR v_i IN 1..27 LOOP
    v_func := v_funcs[v_i];
    -- ASO (365 d): i%6=0 vencido · i%6=1 vencendo · i%6=2 faltando · resto válido. Terceiros: 25 ok, 26 vencido, 27 falta
    v_val := CASE
      WHEN v_i = 25 THEN v_hoje + 180 WHEN v_i = 26 THEN v_hoje - 20 WHEN v_i = 27 THEN NULL
      WHEN v_i % 6 = 0 THEN v_hoje - 15 WHEN v_i % 6 = 1 THEN v_hoje + 5 WHEN v_i % 6 = 2 THEN NULL
      ELSE v_hoje + 120 + v_i END;
    IF v_val IS NOT NULL THEN
      INSERT INTO compliance_documentos (company_id, funcionario_id, tipo_documento_id, arquivo_url, arquivo_nome_original,
         arquivo_mimetype, data_emissao, data_validade, emissor, observacoes, uploaded_by, ativo)
      SELECT c, v_func, t.id, 'demo/sst/aso-' || v_i || '.pdf', 'ASO demo.pdf', 'application/pdf',
             v_val - 365, v_val, 'Clínica Demo Saúde Ocupacional', 'Documento de demonstração', v_robo, true
      FROM compliance_tipos_documento t WHERE t.slug = 'aso';
    END IF;
    -- NR-06 (365 d): i%5=0 faltando · i%7=0 vencido · resto válido
    v_val := CASE WHEN v_i = 27 THEN NULL WHEN v_i % 5 = 0 THEN NULL WHEN v_i % 7 = 0 THEN v_hoje - 40 ELSE v_hoje + 200 END;
    IF v_val IS NOT NULL THEN
      INSERT INTO compliance_documentos (company_id, funcionario_id, tipo_documento_id, arquivo_url, arquivo_nome_original,
         arquivo_mimetype, data_emissao, data_validade, emissor, observacoes, uploaded_by, ativo)
      SELECT c, v_func, t.id, 'demo/sst/nr06-' || v_i || '.pdf', 'NR-06 demo.pdf', 'application/pdf',
             v_val - 365, v_val, 'Instrutor Demo', 'Documento de demonstração', v_robo, true
      FROM compliance_tipos_documento t WHERE t.slug = 'nr06';
    END IF;
    IF v_i <= 24 THEN
      -- Ficha de EPI (sem validade) nos pares
      IF v_i % 2 = 0 THEN
        INSERT INTO compliance_documentos (company_id, funcionario_id, tipo_documento_id, arquivo_url, arquivo_nome_original,
           arquivo_mimetype, data_emissao, sem_validade, observacoes, uploaded_by, ativo)
        SELECT c, v_func, t.id, 'demo/sst/ficha-epi-' || v_i || '.pdf', 'Ficha EPI demo.pdf', 'application/pdf',
               v_hoje - 60, true, 'Documento de demonstração', v_robo, true
        FROM compliance_tipos_documento t WHERE t.slug = 'ficha_epi';
      END IF;
      -- Audiometria (365 d) nos 12 primeiros: i%4=0 vencendo, resto válido
      IF v_i <= 12 THEN
        v_val := CASE WHEN v_i % 4 = 0 THEN v_hoje + 8 ELSE v_hoje + 250 END;
        INSERT INTO compliance_documentos (company_id, funcionario_id, tipo_documento_id, arquivo_url, arquivo_nome_original,
           arquivo_mimetype, data_emissao, data_validade, emissor, observacoes, uploaded_by, ativo)
        SELECT c, v_func, t.id, 'demo/sst/audiometria-' || v_i || '.pdf', 'Audiometria demo.pdf', 'application/pdf',
               v_val - 365, v_val, 'Clínica Demo Saúde Ocupacional', 'Documento de demonstração', v_robo, true
        FROM compliance_tipos_documento t WHERE t.slug = 'audiometria_nr7';
      END IF;
    END IF;
  END LOOP;

  -- 1 dispensa: administrativo sem exposição a ruído (aparece como "não se aplica")
  INSERT INTO compliance_dispensas (company_id, tipo_documento_id, funcionario_id, motivo, dispensado_por, ativo)
  SELECT c, t.id, v_funcs[18], 'Setor administrativo sem exposição a ruído (demonstração)', v_robo, true
  FROM compliance_tipos_documento t WHERE t.slug = 'audiometria_nr7';

  -- ── 5) EPI: catálogo próprio, estoque, fichas, alertas ──
  FOR v_epi IN
    SELECT * FROM (VALUES
      (1, 'luva',               'Luva de malha de aço',        '90001', 400,  ARRAY['corte'],               12),
      (2, 'avental',            'Avental impermeável',         '90002', 300,  ARRAY['umidade','biologico'],  6),
      (3, 'calcado',            'Bota de PVC cano longo',      '90003', 500,  ARRAY['umidade','queda'],     12),
      (4, 'protetor-auricular', 'Protetor auricular tipo plug','90004', -20,  ARRAY['ruido'],                3),
      (5, 'vestimenta',         'Japona térmica para câmara',  '90005', 25,   ARRAY['frio'],                24),
      (6, 'oculos',             'Óculos de proteção incolor',  '90006', 600,  ARRAY['particulas'],          12)
    ) AS e(ordem, cat_slug, nome, ca, ca_dias, riscos, vida)
    ORDER BY ordem
  LOOP
    SELECT id INTO v_cat FROM epi_categoria WHERE slug = v_epi.cat_slug;
    INSERT INTO epi_catalogo (company_id, is_global, categoria_id, nome, ca_numero, ca_validade, fabricante_nome,
       riscos_protege, vida_util_meses, ativo, observacoes)
    VALUES (c, false, v_cat, v_epi.nome, v_epi.ca, v_hoje + v_epi.ca_dias, 'Fabricante Demo EPI',
       v_epi.riscos, v_epi.vida, true, 'Item de demonstração (CA fictício)')
    RETURNING id INTO v_func;
    v_epis := v_epis || v_func;
    INSERT INTO epi_estoque (company_id, catalogo_id, qtd_disponivel, qtd_minima_alerta, localizacao, ativo)
    VALUES (c, v_func, CASE v_epi.ordem WHEN 4 THEN 3 ELSE 20 + v_epi.ordem * 5 END, 10, 'Almoxarifado', true);
  END LOOP;

  -- fichas: 12 primeiros funcionários, 2 EPIs cada (luva/avental ou bota/protetor); 2 trocas atrasadas
  FOR v_i IN 1..12 LOOP
    FOR v_j IN 1..2 LOOP
      v_cat := v_epis[CASE WHEN v_i % 2 = 1 THEN v_j ELSE v_j + 2 END];
      INSERT INTO epi_ficha (company_id, funcionario_id, catalogo_id, status, data_primeira_entrega,
         data_ultima_movimentacao, data_proxima_troca_prevista, qtd_entregas_total, qtd_atual)
      VALUES (c, v_funcs[v_i], v_cat, 'em_uso', v_hoje - 90, v_hoje - 90,
         CASE WHEN v_i IN (3, 7) AND v_j = 1 THEN v_hoje - 10 ELSE v_hoje + 90 END, 1, 1)
      RETURNING id INTO v_ficha;
      INSERT INTO epi_movimentacao (company_id, ficha_id, funcionario_id, catalogo_id, tipo_movimento,
         ca_numero_snapshot, ca_validade_snapshot, fabricante_snapshot, quantidade, motivo,
         operador_user_id, operador_nome, data_movimento)
      SELECT c, v_ficha, v_funcs[v_i], k.id, 'entrega_inicial', k.ca_numero, k.ca_validade, k.fabricante_nome, 1,
             'Entrega na admissão (demonstração)', v_robo, 'Técnico de Segurança Demo', (v_hoje - 90)::timestamptz
      FROM epi_catalogo k WHERE k.id = v_cat;
    END LOOP;
  END LOOP;

  INSERT INTO epi_alerta (company_id, catalogo_id, tipo_alerta, prioridade, titulo, mensagem, status)
  VALUES (c, v_epis[4], 'ca_vencido', 'critica', 'CA vencido: Protetor auricular tipo plug',
          'O CA 90004 venceu há 20 dias. Substitua o lote em uso (demonstração).', 'ativo'),
         (c, v_epis[4], 'estoque_critico', 'alta', 'Estoque crítico: Protetor auricular tipo plug',
          'Restam 3 unidades; o mínimo é 10 (demonstração).', 'ativo');

  -- ── 6) treinamentos NR ──
  INSERT INTO nr_treinamento_tipo (company_id, nr_codigo, nome, carga_horaria, validade_meses, reciclagem_meses, obrigatorio, ativo, tipo_documento_id)
  VALUES (c, 'NR-36', 'Segurança em frigoríficos', 4, 12, 12, true, true, NULL)
  RETURNING id INTO v_tipo;
  INSERT INTO nr_turma (company_id, tipo_id, data_realizacao, instrutor, carga_horaria, local, status, observacao)
  VALUES (c, v_tipo, v_hoje - 60, 'Instrutor Demo', 4, 'Sala de treinamento', 'realizada', 'Turma de demonstração')
  RETURNING id INTO v_turma;
  INSERT INTO nr_turma_presenca (company_id, turma_id, funcionario_id, presente, aproveitamento, data_emissao_certificado)
  SELECT c, v_turma, v_funcs[g], true, 90, v_hoje - 60 FROM generate_series(1, 10) g;

  INSERT INTO nr_treinamento_tipo (company_id, nr_codigo, nome, carga_horaria, validade_meses, reciclagem_meses, obrigatorio, ativo, tipo_documento_id)
  SELECT c, 'NR-06', 'Uso correto de EPI', 2, 12, 12, true, true, t.id FROM compliance_tipos_documento t WHERE t.slug = 'nr06';
  INSERT INTO nr_treinamento_tipo (company_id, nr_codigo, nome, carga_horaria, validade_meses, reciclagem_meses, obrigatorio, ativo)
  VALUES (c, 'NR-12', 'Máquinas e equipamentos', 8, 24, 24, false, true)
  RETURNING id INTO v_tipo;
  INSERT INTO nr_turma (company_id, tipo_id, data_realizacao, instrutor, carga_horaria, local, status, observacao)
  VALUES (c, v_tipo, v_hoje + 15, 'Instrutor Demo', 8, 'Linha de produção', 'planejada', 'Turma de demonstração');

  SELECT count(*) INTO n_docs   FROM compliance_documentos WHERE company_id = c;
  SELECT count(*) INTO n_fichas FROM epi_ficha WHERE company_id = c;
  RETURN jsonb_build_object('ok', true, 'bloco', 'sst',
    'setores', (SELECT count(*) FROM compliance_setores WHERE company_id = c),
    'funcionarios', (SELECT count(*) FROM compliance_funcionarios WHERE company_id = c),
    'terceirizados', (SELECT count(*) FROM compliance_funcionarios WHERE company_id = c AND vinculo_tipo = 'terceirizado'),
    'documentos', n_docs,
    'vencidos', (SELECT count(*) FROM compliance_documentos WHERE company_id = c AND status_validade = 'vencido'),
    'vencendo', (SELECT count(*) FROM compliance_documentos WHERE company_id = c AND status_validade = 'vencendo'),
    'epi_itens', (SELECT count(*) FROM epi_catalogo WHERE company_id = c),
    'epi_fichas', n_fichas,
    'ponto_dias', (SELECT count(*) FROM ind_ponto_dia WHERE company_id = c),
    'prod_setor', (SELECT count(*) FROM prod_setor WHERE company_id = c),
    'nr_presencas', (SELECT count(*) FROM nr_turma_presenca WHERE company_id = c),
    'alertas_caixa_robo', (SELECT count(*) FROM bpo_inbox_items WHERE company_id = c AND tipo_origem = 'compliance_vencimento' AND assigned_to = v_robo),
    'alertas_caixa_outros', (SELECT count(*) FROM bpo_inbox_items WHERE company_id = c AND tipo_origem = 'compliance_vencimento' AND assigned_to IS DISTINCT FROM v_robo));
END $function$;

REVOKE ALL ON FUNCTION public.fn_gold_sst_seed_reparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gold_sst_seed_reparar(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fn_demo_seed_industria_postos — generalizada (005 e 00b)
--    turnos-catálogo: ids fixos DERIVADOS da empresa (005 → dede0005…, 00b → dede000b…),
--    preservando exatamente os ids da 005 e evitando colisão entre demos.
-- ─────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_demo_seed_industria_postos — seed de DEMO, trava is_demo + company fixa (005/00b) no topo
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_postos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c        uuid := p_company_id;   -- generalizada: 005 e 00b
  -- turnos-catálogo (ids fixos próprios por empresa; não colidem com as instâncias diárias …1001/…1002)
  v_t1 uuid; v_t2 uuid; v_t3 uuid;
  v_planta uuid;
  v_abate  uuid;
  v_desossa uuid;
  v_setor  uuid;
  v_posto  uuid;
  v_cargo  uuid;
  v_i      int := 0;
  v_cpf    text;
  r        record;
  -- fluxo produtivo (raias) + rendimento
  v_fab uuid; v_fde uuid;
  v_boi uuid; v_carc uuid; v_dia uuid; v_coxao uuid; v_pic uuid; v_sebo uuid;
BEGIN
  -- trava: só as DEMOs SST/EHS
  IF c IS NULL
     OR c NOT IN ('b0700000-0000-4000-a000-000000000005'::uuid,
                  'b0700000-0000-4000-a000-00000000000b'::uuid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- ids fixos dos turnos derivados do último nibble da empresa (005 → '5', 00b → 'b'):
  -- preserva os ids históricos da 005 (dede0005-…) e dá à 00b ids próprios (dede000b-…).
  v_t1 := ('dede000' || right(c::text, 1) || '-0000-4000-a000-000000001201')::uuid;
  v_t2 := ('dede000' || right(c::text, 1) || '-0000-4000-a000-000000001202')::uuid;
  v_t3 := ('dede000' || right(c::text, 1) || '-0000-4000-a000-000000001203')::uuid;

  -- delete físico liberado SÓ nesta transação e SÓ nas linhas da demo (RD-30: manutenção deliberada)
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);

  SELECT id INTO v_planta FROM industrial_plants WHERE company_id = c AND codigo_planta = 'DEMO-SST';
  IF v_planta IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_demo_ausente');
  END IF;

  -- os setores são recriados a cada reset (ids novos): procura por nome
  SELECT id INTO v_abate   FROM prod_setor WHERE company_id = c AND nome = 'Abate'   ORDER BY ordem LIMIT 1;
  SELECT id INTO v_desossa FROM prod_setor WHERE company_id = c AND nome = 'Desossa' ORDER BY ordem LIMIT 1;
  IF v_abate IS NULL OR v_desossa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setores_demo_ausentes');
  END IF;

  -- idempotência: zera o fluxo produtivo da DEMO ANTES dos postos (prod_fluxo_etapa
  -- aponta para posto/fluxo; prod_tarefa para etapa; prod_estrutura para fluxo).
  DELETE FROM prod_tarefa       WHERE company_id = c;
  DELETE FROM prod_estrutura    WHERE company_id = c;
  DELETE FROM prod_fluxo_etapa  WHERE company_id = c;
  DELETE FROM prod_fluxo        WHERE company_id = c;

  -- idempotência: zera só os postos/custos/pessoas desta DEMO
  DELETE FROM prod_posto_custo  WHERE company_id = c;
  DELETE FROM prod_posto_pessoa WHERE company_id = c;
  DELETE FROM prod_posto_turno  WHERE company_id = c;
  DELETE FROM prod_posto        WHERE company_id = c;

  -- turnos-catálogo T1/T2/T3 (ids fixos por empresa, idempotentes). Fonte dos horários do quadro de turno e do seletor.
  INSERT INTO ind_turnos (id, company_id, plant_id, turno, codigo, nome, inicio, fim, ativo)
  VALUES
    (v_t1, c, v_planta, 'A', 'T1', 'T1 · 06:00–14:00', '06:00', '14:00', true),
    (v_t2, c, v_planta, 'B', 'T2', 'T2 · 14:00–22:00', '14:00', '22:00', true),
    (v_t3, c, v_planta, 'C', 'T3', 'T3 · 22:00–06:00', '22:00', '06:00', true)
  ON CONFLICT (id) DO UPDATE SET
    company_id = EXCLUDED.company_id, plant_id = EXCLUDED.plant_id, turno = EXCLUDED.turno,
    codigo = EXCLUDED.codigo, nome = EXCLUDED.nome, inicio = EXCLUDED.inicio, fim = EXCLUDED.fim, ativo = true;

  -- catálogo de postos: fluxo do abate → desossa. ocupa=false ⇒ vaga aberta (sem pessoa).
  -- (setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos_pct, cargo)
  FOR r IN
    SELECT * FROM (VALUES
      -- Abate (fluxo da nave de abate)
      ('A','01','Insensibilização',          1, true,  'Bruno Carvalho Demo',  3200, 68, 'Operador de abate'),
      ('A','02','Sangria',                    2, true,  'Diego Rocha Demo',     3000, 68, 'Operador de abate'),
      ('A','03','Esfola',                     3, true,  'Fábio Lima Demo',      3100, 68, 'Operador de abate'),
      ('A','04','Evisceração',                4, true,  'Hugo Martins Demo',    3100, 68, 'Operador de abate'),
      ('A','05','Inspeção oficial (SIF)',     5, false, NULL,                   3600, 68, 'Técnico de segurança do trabalho'),
      ('A','06','Tipificação e pesagem',      6, true,  'João Pedro Demo',      3400, 68, 'Operador de abate'),
      -- Desossa (sala de desossa / embalagem)
      ('D','01','Quarteamento',               1, true,  'Lucas Ferreira Demo',  2900, 68, 'Desossador'),
      ('D','02','Desossa do dianteiro',       2, true,  'Nelson Pires Demo',    2950, 68, 'Desossador'),
      ('D','03','Desossa do traseiro',        3, false, NULL,                   2950, 68, 'Desossador'),
      ('D','04','Embalagem a vácuo',          4, true,  'Paulo Teixeira Demo',  2700, 68, 'Auxiliar de embalagem'),
      ('D','05','Expedição',                  5, false, NULL,                   2800, 68, 'Operador de câmara fria')
    ) AS t(setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos, cargo)
  LOOP
    v_setor := CASE r.setor_tag WHEN 'A' THEN v_abate ELSE v_desossa END;

    -- cargo do posto: resolve prod_cargo por nome (cria se faltar) e carimba no posto
    v_cargo := NULL;
    SELECT id INTO v_cargo FROM prod_cargo
     WHERE company_id = c AND plant_id = v_planta AND nome = r.cargo AND ativo
     ORDER BY created_at LIMIT 1;
    IF v_cargo IS NULL THEN
      INSERT INTO prod_cargo (company_id, plant_id, nome)
      VALUES (c, v_planta, r.cargo) RETURNING id INTO v_cargo;
    END IF;

    INSERT INTO prod_posto (company_id, plant_id, setor_id, cargo_id, numero, atividade, ordem_linha, alocacao, ativo)
    VALUES (c, v_planta, v_setor, v_cargo, r.numero, r.atividade, r.ordem, 'fixa', true)
    RETURNING id INTO v_posto;

    -- custo do posto (salário FAKE + encargos). Base do custo de produção por posto na tela.
    -- horas_operacao_mes = 176 (jornada industrial padrão ~44 h/semana) para o R$/h calcular.
    INSERT INTO prod_posto_custo (company_id, plant_id, posto_id, vigencia_inicio, mao_obra_mes, encargos_pct, horas_operacao_mes)
    VALUES (c, v_planta, v_posto, current_date, r.salario, r.encargos, 176);

    -- quadro de turno projetado (fonte do T1/T2/T3 na tela Quadro): 1 pessoa no T1 em todo posto;
    -- a linha de Abate (postos 01–04) opera em 2 turnos → +1 no T2.
    INSERT INTO prod_posto_turno (company_id, plant_id, posto_id, turno_id, hora_entrada, hora_saida, pessoas, vigencia_inicio)
    VALUES (c, v_planta, v_posto, v_t1, '06:00', '14:00', 1, current_date);
    IF r.setor_tag = 'A' AND r.ordem <= 4 THEN
      INSERT INTO prod_posto_turno (company_id, plant_id, posto_id, turno_id, hora_entrada, hora_saida, pessoas, vigencia_inicio)
      VALUES (c, v_planta, v_posto, v_t2, '14:00', '22:00', 1, current_date);
    END IF;

    -- pessoa com CPF MANUAL (sem funcionário real): demonstra o caso "RH preenche na tela".
    IF r.ocupa THEN
      v_i := v_i + 1;
      v_cpf := fn_demo_cpf_valido(556000000 + v_i);
      INSERT INTO prod_posto_pessoa (company_id, plant_id, posto_id, funcionario_id, cpf, vigencia_inicio)
      VALUES (c, v_planta, v_posto, NULL, v_cpf, current_date);
    END IF;
  END LOOP;

  -- ===== fluxo produtivo (raias) + etapas + rendimento + tarefas =====
  -- Sem isto, Apontamento/Mapa/Tarefas abrem vazias e a jornada b/c não é exercitável.

  -- 1) raias
  INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
  VALUES (c, v_planta, v_abate,   'Linha de Abate',   'compartilhado', 'desmontagem', 1, true)
  RETURNING id INTO v_fab;
  INSERT INTO prod_fluxo (company_id, plant_id, setor_id, nome, modo, direcao, ordem, ativo)
  VALUES (c, v_planta, v_desossa, 'Linha de Desossa', 'compartilhado', 'desmontagem', 2, true)
  RETURNING id INTO v_fde;

  -- 2) etapas = postos ativos de cada setor, em ordem de linha
  INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, tempo_ciclo_seg, pessoas, controle_sif)
  SELECT c, v_planta, v_fab, p.id, p.ordem_linha, p.atividade, 'manual', 45, 2, (p.atividade ILIKE '%Inspe%')
    FROM prod_posto p
   WHERE p.company_id = c AND p.setor_id = v_abate AND p.ativo;
  INSERT INTO prod_fluxo_etapa (company_id, plant_id, fluxo_id, posto_id, ordem, nome, tipo, tempo_ciclo_seg, pessoas, controle_sif)
  SELECT c, v_planta, v_fde, p.id, p.ordem_linha, p.atividade, 'manual', 60, 3, false
    FROM prod_posto p
   WHERE p.company_id = c AND p.setor_id = v_desossa AND p.ativo;

  -- 3) rendimento do caminho (entra/sai por raia)
  SELECT id INTO v_boi   FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-001';
  SELECT id INTO v_carc  FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-010';
  SELECT id INTO v_dia   FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-100';
  SELECT id INTO v_coxao FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-202';
  SELECT id INTO v_pic   FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-204';
  SELECT id INTO v_sebo  FROM prod_produto WHERE company_id = c AND plant_id = v_planta AND codigo = 'BOV-400';

  INSERT INTO prod_estrutura (company_id, plant_id, fluxo_id, origem_produto_id, produto_id, tipo_saida, rendimento_padrao_pct, status, vigencia_inicio, ativo)
  SELECT s.a, s.b, s.c, s.d, s.e, s.f, s.g, s.h, s.i, s.j
    FROM (VALUES
      (c, v_planta, v_fab, v_boi,  v_carc,  'principal',  54.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_dia,   'principal',  48.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_coxao, 'coproduto',   9.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_pic,   'coproduto',   2.0, 'validado', CURRENT_DATE, true),
      (c, v_planta, v_fde, v_carc, v_sebo,  'subproduto', 12.0, 'validado', CURRENT_DATE, true)
    ) s(a, b, c, d, e, f, g, h, i, j)
   WHERE s.d IS NOT NULL AND s.e IS NOT NULL AND s.d <> s.e;

  -- 4) 1 tarefa por etapa (cadeia fluxo→etapa→tarefa navegável na tela de Tarefas)
  INSERT INTO prod_tarefa (company_id, plant_id, etapa_id, ordem, nome, estado, ativo)
  SELECT e.company_id, e.plant_id, e.id, 1, e.nome, 'valida', true
    FROM prod_fluxo_etapa e
   WHERE e.company_id = c AND e.deleted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_postos',
    'postos',        (SELECT count(*) FROM prod_posto WHERE company_id = c),
    'postos_com_cargo', (SELECT count(*) FROM prod_posto WHERE company_id = c AND cargo_id IS NOT NULL),
    'turnos_quadro', (SELECT count(*) FROM prod_posto_turno WHERE company_id = c),
    'ocupados',      (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'vagas_abertas', (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND NOT EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'pessoas',       (SELECT count(*) FROM prod_posto_pessoa WHERE company_id = c),
    'custos',        (SELECT count(*) FROM prod_posto_custo WHERE company_id = c),
    'fluxos',        (SELECT count(*) FROM prod_fluxo WHERE company_id = c),
    'etapas',        (SELECT count(*) FROM prod_fluxo_etapa WHERE company_id = c),
    'rendimentos',   (SELECT count(*) FROM prod_estrutura WHERE company_id = c),
    'tarefas',       (SELECT count(*) FROM prod_tarefa WHERE company_id = c));
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_postos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_postos(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) fn_demo_seed_industria_rh_quadro — generalizada (005 e 00b)
-- ─────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_demo_seed_industria_rh_quadro — seed de DEMO, trava is_demo + company fixa (005/00b) no topo
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_rh_quadro(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c uuid := p_company_id;   -- generalizada: 005 e 00b
BEGIN
  -- trava: só as DEMOs SST/EHS
  IF c IS NULL
     OR c NOT IN ('b0700000-0000-4000-a000-000000000005'::uuid,
                  'b0700000-0000-4000-a000-00000000000b'::uuid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- idempotência: zera só o complemento desta DEMO (sem trava de delete físico nesta tabela)
  DELETE FROM rh_pessoa_complemento WHERE company_id = c;

  -- Complemento para cada colaborador do ponto (função → cargo, departamento → setor).
  INSERT INTO rh_pessoa_complemento
    (company_id, cpf, matricula, cargo_id, setor_id, supervisor_nome, salario_base, observacao)
  SELECT c, p.cpf, btrim(p.matricula), cg.id, st.id,
    'Supervisor ' || COALESCE(NULLIF(btrim(p.departamento), ''), 'Geral'),
    CASE upper(btrim(COALESCE(p.funcao, '')))
      WHEN 'OPERADOR DE ABATE'               THEN 2600
      WHEN 'DESOSSADOR'                      THEN 2900
      WHEN 'AUXILIAR DE EMBALAGEM'           THEN 2100
      WHEN 'OPERADOR DE CÂMARA FRIA'         THEN 2400
      WHEN 'MECÂNICO DE MANUTENÇÃO'          THEN 3500
      WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN 4200
      ELSE 2000
    END,
    'seed DEMO (fictício)'
  FROM (
    SELECT DISTINCT ON (cpf) cpf, matricula, funcao, departamento
    FROM ind_ponto_colaborador
    WHERE company_id = c AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ) p
  LEFT JOIN prod_cargo cg ON cg.company_id = c AND cg.ativo
       AND upper(btrim(cg.nome)) = upper(btrim(p.funcao))
  LEFT JOIN prod_setor st ON st.company_id = c AND st.ativo
       AND upper(btrim(st.nome)) = upper(btrim(p.departamento));

  -- Parâmetro de custo da folha (encargos e horas/mês padrão) — base do custo/hora.
  INSERT INTO rh_parametro_custo (company_id, encargos_pct, horas_mes, fonte_custo, atualizado_em)
  VALUES (c, 38.35, 220, 'folha_total', now())
  ON CONFLICT (company_id) DO UPDATE
    SET encargos_pct = EXCLUDED.encargos_pct,
        horas_mes    = EXCLUDED.horas_mes,
        fonte_custo  = EXCLUDED.fonte_custo,
        atualizado_em = now();

  -- ESCALA/CARGA (FATIA 2): jornada por colaborador do ponto, derivada da FUNÇÃO.
  --  · câmara fria → 12x36 noturno · manutenção/segurança → 5x2 44h (administrativa)
  --  · abate/desossa/embalagem → 6x1 44h (produção).
  -- Upsert pela chave única da tabela (idempotente; vigência = início do ano corrente).
  INSERT INTO ind_ponto_jornada
    (company_id, cpf, registration_number, escala_nome, tipo_escala, horas_semana, horas_mes,
     hora_entrada, hora_saida, intervalo_min, vigencia_inicio, vigencia_fim, fonte, sincronizado_em, atualizado_em)
  SELECT c, p.cpf, btrim(p.matricula),
    j.escala_nome, j.tipo_escala, j.horas_semana, j.horas_mes,
    j.hora_entrada, j.hora_saida, 60,
    date_trunc('year', CURRENT_DATE)::date, NULL, 'sync', now(), now()
  FROM (
    SELECT DISTINCT ON (cpf) cpf, matricula, funcao
    FROM ind_ponto_colaborador
    WHERE company_id = c AND cpf IS NOT NULL
    ORDER BY cpf, created_at DESC NULLS LAST
  ) p
  CROSS JOIN LATERAL (VALUES (
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN '12x36 noturno'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN '5x2 44h (administrativa)'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN '5x2 44h (administrativa)'
        ELSE '6x1 44h (produção)' END,
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN '12x36'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN '5x2'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN '5x2'
        ELSE '6x1' END,
      (CASE upper(btrim(COALESCE(p.funcao,''))) WHEN 'OPERADOR DE CÂMARA FRIA' THEN 42.00 ELSE 44.00 END)::numeric(6,2),
      (CASE upper(btrim(COALESCE(p.funcao,''))) WHEN 'OPERADOR DE CÂMARA FRIA' THEN 180.00 ELSE 220.00 END)::numeric(7,2),
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN TIME '19:00'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN TIME '08:00'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN TIME '08:00'
        ELSE TIME '06:00' END,
      CASE upper(btrim(COALESCE(p.funcao,'')))
        WHEN 'OPERADOR DE CÂMARA FRIA' THEN TIME '07:00'
        WHEN 'MECÂNICO DE MANUTENÇÃO' THEN TIME '17:48'
        WHEN 'TÉCNICO DE SEGURANÇA DO TRABALHO' THEN TIME '17:48'
        ELSE TIME '14:48' END
  )) AS j(escala_nome, tipo_escala, horas_semana, horas_mes, hora_entrada, hora_saida)
  ON CONFLICT (company_id, lower(COALESCE(cpf,'')), lower(COALESCE(registration_number,'')), COALESCE(vigencia_inicio, DATE '0001-01-01'))
  DO UPDATE SET
    escala_nome   = EXCLUDED.escala_nome,
    tipo_escala   = EXCLUDED.tipo_escala,
    horas_semana  = EXCLUDED.horas_semana,
    horas_mes     = EXCLUDED.horas_mes,
    hora_entrada  = EXCLUDED.hora_entrada,
    hora_saida    = EXCLUDED.hora_saida,
    intervalo_min = EXCLUDED.intervalo_min,
    fonte         = EXCLUDED.fonte,
    sincronizado_em = EXCLUDED.sincronizado_em,
    atualizado_em = now();

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_rh_quadro',
    'complementos', (SELECT count(*) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_salario',  (SELECT count(salario_base) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'com_cargo',    (SELECT count(cargo_id) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL),
    'jornadas',     (SELECT count(*) FROM ind_ponto_jornada WHERE company_id = c),
    'folha_base',   (SELECT COALESCE(sum(salario_base),0) FROM rh_pessoa_complemento WHERE company_id = c AND excluido_em IS NULL));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_rh_quadro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_rh_quadro(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) fn_demo_reset — ramo da DEMO EHS (00b): seed SST + postos + matrizes EHS + RH.
--    Sem frota nem nada fora do EHS (plano da 00b é só Compliance).
-- ─────────────────────────────────────────────────────────────────────────────
-- ci-sem-guarda: fn_demo_reset — seed de DEMO, trava is_demo + company fixa (005/00b) no topo
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
    WHEN 'b0700000-0000-4000-a000-00000000000b'::uuid THEN 'fn_gold_sst_seed_reparar'  -- DEMO EHS (plano Compliance)
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  -- conserto-main 14/11 (gilberto-esteira): a DEMO 005/00b apaga prod_setor no seed principal; o complemento de
  -- RH da rodada anterior (rh_pessoa_complemento.setor_id -> prod_setor, FK NO ACTION) bloqueia esse DELETE.
  -- Limpa o complemento FICTÍCIO ANTES dos seeds (fn_demo_seed_industria_rh_quadro o re-semeia no fim).
  -- is_demo já validado acima; dado 100% fake (RD-69/LGPD); nenhum cliente é tocado.
  IF p_company_id IN ('b0700000-0000-4000-a000-000000000005'::uuid,
                      'b0700000-0000-4000-a000-00000000000b'::uuid) THEN
    DELETE FROM public.rh_pessoa_complemento WHERE company_id = p_company_id;
  END IF;

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

  -- 16/11 (code-desenvolvedor-3 · EHS S1 piloto, re-seed RECONCILIADO pós-reversão do #5174): matrizes de
  -- risco (S1.1), EPI (S1.2) e treino (S1.3) por setor/posto, DURÁVEIS a cada reset (os seeds das migrations
  -- são one-shot e o reset os apagava). RECONCILIADO com o caminho protegido SST·LTCAT: a função NÃO semeia
  -- RISCO na Desossa (Desossa começa vazia, como o teste exige); EPI e treino seguem em todos. Roda DEPOIS
  -- dos postos (precisa dos postos/setores). RD-69: tudo FAKE; trava is_demo na função.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
  END IF;

  -- 12/11 (desenvolvedor_4_g · PDCA aud8 Controle de frota, DEMO 005): frota FICTÍCIA (veículos + planos de
  -- manutenção + documentos + custos + viagens/abastecimento) para os 6 KPIs da tela de frota deixarem de
  -- ficar zerados e a jornada de inclusão/edição/custo ser verificável. RD-69: tudo FAKE. Idempotente e is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('frota', public.fn_demo_seed_industria_frota(p_company_id));
  END IF;

  -- 19/11 (desenvolvedor_4_g · PDCA aud8 Quadro de pessoal, DEMO 005): re-semeia o complemento de RH (cargo,
  -- setor, supervisor, salário-base) e a jornada/escala por colaborador do ponto, que o reset APAGA no início
  -- (conserto-main 14/11) mas deixou de re-semear. Roda por ÚLTIMO no bloco da 005 — depois de postos recriar
  -- prod_setor/prod_cargo que o re-seed referencia por nome. Sem isso Supervisor/Escala/Carga/Salário ficam "—"
  -- na tela /dashboard/industrial/rh/quadro. Idempotente e travado em is_demo (RD-69: dado 100% fictício).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 20/11 (code-desenvolvedor-3 · EHS-0, CEO 20/11 16:40): ramo da DEMO EHS "EHS Modelo - DEMO" (00b).
  -- Dados auditáveis nas 24 telas /dashboard/ehs/*, como nas outras verticais. Base SST (fn_gold_sst_seed_reparar
  -- acima via v_seed) + postos + matrizes de risco/EPI/treino + quadro de RH. SEM frota (plano só Compliance).
  -- Cada bloco é company-scoped e is_demo; roda na ordem de dependência (postos → ehs_matrizes → rh_quadro).
  IF p_company_id = 'b0700000-0000-4000-a000-00000000000b'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
