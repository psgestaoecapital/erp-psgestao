-- RD-69 · Demonstração "Indústria (SST) - DEMO" (decisão do CEO 26/09: criar pelo caminho oficial com reset).
-- Destrava #77/#53 (LTCAT: setor → função → riscos/EPIs/treinamentos) e #75 (prints da Matriz de Conformidade)
-- sem tocar a Frioeste: todo teste e toda foto do robô na área compliance passam a rodar nesta demo.
--
-- Empresa b0700000-0000-4000-a000-000000000005 (is_demo, CNPJ com DV válido e não-colidente), plano v15_compliance
-- (R$ 0, fora do MRR — fn_empresas_produtivas exclui demo), acesso do robô e do CEO, e demo_por_area 'compliance'.
--
-- fn_gold_sst_seed_reparar(company): seed determinístico e AUTO-RESETÁVEL. Zera os dados SST da demo e reinsere
-- (demo suja volta ao estado conhecido). Só age na empresa 005 (guarda dura; fn_demo_reset já exigiu is_demo).
-- O delete físico de funcionário/ponto é bloqueado por fn_bloqueia_delete_fisico (RD-30); aqui ele é liberado
-- SÓ nesta transação (set_config local) e SÓ para a empresa de demonstração — manutenção deliberada da demo.
--
-- Conteúdo (todos os estados que as telas precisam mostrar):
--  • 6 setores próprios + planta "Planta Demo" + ponto (24 colaboradores × 5 dias, departamento = setor);
--    2 setores já importados em prod_setor (LTCAT mostra "já cadastrados" e "novos").
--  • 24 funcionários diretos (CPF com DV válido) + 1 prestador com 3 terceirizados.
--  • Matriz: documentos válidos, vencendo (≤10 dias), vencidos, sem validade, faltando e 1 dispensa
--    ("não se aplica"). Terceirizados entram pela exigência 'funcionario_terceiro' (ASO e NR-06) — os diretos
--    seguem os tipos globais (nenhuma exigência 'funcionario'/'ambos', de propósito).
--  • EPI: 6 itens próprios (1 CA vencido, 1 vencendo), estoque (1 abaixo do mínimo), fichas de 12 funcionários
--    com entrega registrada (movimentação com hash), 2 trocas atrasadas e 2 alertas.
--  • Treinamentos NR: 3 tipos, 1 turma realizada com 10 presenças e 1 turma planejada.
--  • Responsável de compliance da demo = robô: os alertas de vencimento que o trigger manda para a caixa do BPO
--    caem no robô, NUNCA na caixa de um operador real (sem responsável, o fallback é o operador BPO).
-- Arquivos: arquivo_url aponta para um caminho de demonstração sem objeto no Storage — a matriz, os status e os
-- alertas funcionam; o download do arquivo da demo não abre (não há arquivo real a baixar).

-- ── 1) Empresa, plano, acessos, área ─────────────────────────────────────────────────────────────────
INSERT INTO public.companies (id, org_id, razao_social, nome_fantasia, is_demo, ambiente_tenant, cnpj, restrita_ps_admin, uf_fiscal)
VALUES ('b0700000-0000-4000-a000-000000000005', 'c830f980-9be9-40c1-bb46-584cdc92dd65',
        'Demonstração Indústria Alimentícia LTDA', 'Indústria (SST) - DEMO',
        true, 'auditoria', '55500000000142', false, 'SC')
ON CONFLICT (id) DO UPDATE SET
  razao_social = EXCLUDED.razao_social, nome_fantasia = EXCLUDED.nome_fantasia,
  is_demo = true, ambiente_tenant = 'auditoria', restrita_ps_admin = false, cnpj = EXCLUDED.cnpj;

INSERT INTO public.tenant_subscriptions (company_id, plan_id, status, monthly_price_brl)
SELECT 'b0700000-0000-4000-a000-000000000005', 'v15_compliance', 'active', 0
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions
  WHERE company_id = 'b0700000-0000-4000-a000-000000000005' AND plan_id = 'v15_compliance');

-- robô (screenshot@) e CEO — mesmos papéis das outras demos
INSERT INTO public.user_companies (user_id, company_id, role)
SELECT u.id, 'b0700000-0000-4000-a000-000000000005', u.papel
FROM (VALUES ('74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'::uuid, 'adm'),
             ('4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid, 'acesso_total')) AS u(id, papel)
WHERE EXISTS (SELECT 1 FROM public.users x WHERE x.id = u.id)
  AND NOT EXISTS (SELECT 1 FROM public.user_companies uc
                  WHERE uc.user_id = u.id AND uc.company_id = 'b0700000-0000-4000-a000-000000000005');

-- o robô fotografa a área compliance NA DEMO (nunca na Frioeste)
INSERT INTO public.demo_por_area (area, company_id)
VALUES ('compliance', 'b0700000-0000-4000-a000-000000000005')
ON CONFLICT (area) DO UPDATE SET company_id = EXCLUDED.company_id;

-- ── 2) Seed determinístico ───────────────────────────────────────────────────────────────────────────
-- search_path inclui 'extensions': o trigger de hash da movimentação de EPI chama digest() sem schema.
CREATE OR REPLACE FUNCTION public.fn_gold_sst_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c        constant uuid := 'b0700000-0000-4000-a000-000000000005';
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
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_sst');
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

REVOKE ALL ON FUNCTION public.fn_gold_sst_seed_reparar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gold_sst_seed_reparar(uuid) TO service_role;

-- ── 3) fn_demo_reset: braço 005 (reproduz a versão vigente e só acrescenta a SST) ────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;

-- ── 4) primeira carga (o reset repõe o mesmo estado sempre que chamado) ──────────────────────────────
SELECT public.fn_demo_reset('b0700000-0000-4000-a000-000000000005');
