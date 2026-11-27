-- Hub Fiscal demonstrável na DEMO GE (b0700000-0000-4000-a000-000000000004)
-- Tarefa PDCA auditor_pdca_2 (27/11) · Code: code-desenvolvedor-3
--
-- PROBLEMA (RD-38, provado no banco 27/11): fn_hub_fiscal_resumo(DEMO GE) retorna TUDO zero.
-- O Hub Fiscal conta NOTAS EMITIDAS (erp_nfe_emitidas/erp_nfse_emitidas via v_hub_fiscal_cards)
-- e lê a config de erp_fiscal_provider_config. A DEMO GE não tinha nem config nem emitidas.
-- A RAIZ não é "falta de dado": o gatilho BEFORE INSERT `trg_bloqueia_emissao_demo`
-- (fn_bloqueia_emissao_nao_produtiva) BLOQUEIA qualquer insert de nota emitida quando
-- companies.ambiente_tenant <> 'producao'. A DEMO GE é ambiente_tenant='auditoria', então
-- nenhum seed conseguia popular as emitidas — por isso o seed fiscal existente só cobria
-- as RECEBIDAS (erp_nfe_recebidas), nunca as emitidas.
--
-- SOLUÇÃO (aditiva, idempotente, SÓ-DEMO):
--  (1) Dá ao guard de emissão o MESMO escape já usado pelo guard de delete físico
--      (set_config('app.permitir_delete_fisico',...)): uma flag transaction-local
--      `app.permitir_emissao_demo` que SÓ libera empresa is_demo=true e SÓ quando um seed
--      SECURITY DEFINER opta explicitamente. Tenant REAL (is_demo=false) continua 100% barrado,
--      e todo o caminho de emissão de produção (sem a flag) segue barrado como hoje.
--  (2) Estende fn_demo_seed_ge_fiscal (durável — re-rodado pelo fn_demo_reset) para semear,
--      além das recebidas já existentes, a config fiscal da DEMO GE e um punhado de NFS-e/NF-e
--      emitidas (a maioria autorizada no mês corrente, +1 processando +1 com erro, algumas com
--      xml_storage_path) para o Hub Fiscal sair do zero ponta a ponta.
--
-- RD-104: NÃO altera regra de cálculo (CBS/IBS/ISS), NÃO usa alíquota chapada em motor de
-- emissão, NÃO emite com regra vencida. São documentos de DEMONSTRAÇÃO (ambiente='homologacao',
-- valores gravados estáticos) numa empresa fictícia isolada; a lógica fiscal de produção fica intacta.
-- Sensível (núcleo fiscal + toca guard) → revisao-eng-chefe, espera MERGE AUTORIZADO.

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Guard de emissão: escape SÓ-DEMO, opt-in, transaction-local (mesmo padrão do delete físico)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bloqueia_emissao_nao_produtiva()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_amb text; v_is_demo boolean;
BEGIN
  SELECT ambiente_tenant, is_demo INTO v_amb, v_is_demo
    FROM public.companies WHERE id = NEW.company_id;
  IF v_amb IS DISTINCT FROM 'producao' THEN
    -- Escape de DEMONSTRAÇÃO: só empresa is_demo e só quando um seed SECURITY DEFINER
    -- liga a flag transaction-local (current_setting missing_ok=true → NULL se não setada).
    -- Nunca libera tenant real; nunca libera sem opt-in explícito.
    IF v_is_demo IS TRUE
       AND current_setting('app.permitir_emissao_demo', true) = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'Operacao real bloqueada: esta empresa e de % (dados ficticios). Use uma empresa de producao.', COALESCE(v_amb,'ambiente desconhecido')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) Seed fiscal da DEMO GE: recebidas (mantidas) + config + emitidas (NOVO)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_fiscal(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_forn uuid; v_forn_nome text; v_forn_doc text;
  v_hoje date := CURRENT_DATE;
  v_chave text;
  v_agora timestamptz := now();
  v_razao text;
  v_emit_cnpj text := '11222333000181';   -- CNPJ fictício da DEMO (homologação)
  v_m1 timestamptz; v_m2 timestamptz; v_m3 timestamptz; v_prev timestamptz;
BEGIN
  -- ci-sem-guarda: fn_demo_seed_ge_fiscal — seed da DEMO fixado no id is_demo b0700000-…-0004 por trava dupla
  -- (p_company = v_bot E companies.is_demo IS TRUE); nunca grava em tenant real e roda por service_role/reset
  -- (sem auth.uid()), onde fn__guarda_empresa não se aplica. Acesso restrito a service_role (REVOKE no fim).
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;
  -- trava dupla: a empresa precisa ser de demonstração (nunca roda em tenant real)
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_bot AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  SELECT COALESCE(nome_fantasia, razao_social, 'Comércio (GE) - DEMO') INTO v_razao
    FROM companies WHERE id = v_bot;

  SELECT id, nome_fantasia, COALESCE(cnpj_cpf, cpf_cnpj) INTO v_forn, v_forn_nome, v_forn_doc
    FROM erp_fornecedores WHERE company_id=v_bot ORDER BY created_at, id LIMIT 1;

  -- ── 1 perfil fiscal (idempotente por company_id único) ──
  INSERT INTO fiscal_configuracao (company_id, regime, simples_anexo, icms_aliquota, iss_aliquota,
    pis_aliquota, cofins_aliquota, prazo_rec_dias, percentual_credito, atualizado_em)
  VALUES (v_bot, 'simples', 1, 12.0, 5.0, 0.65, 3.0, 30, 0, now())
  ON CONFLICT (company_id) DO UPDATE SET
    regime=EXCLUDED.regime, simples_anexo=EXCLUDED.simples_anexo, icms_aliquota=EXCLUDED.icms_aliquota,
    iss_aliquota=EXCLUDED.iss_aliquota, pis_aliquota=EXCLUDED.pis_aliquota, cofins_aliquota=EXCLUDED.cofins_aliquota,
    prazo_rec_dias=EXCLUDED.prazo_rec_dias, percentual_credito=EXCLUDED.percentual_credito, atualizado_em=now();

  -- ── RESET idempotente das NF-e recebidas do seed (escape de delete auditado) ──
  PERFORM set_config('app.permitir_delete_fisico','on',true);
  DELETE FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge';
  PERFORM set_config('app.permitir_delete_fisico','off',true);

  -- ── 3 NF-e recebidas (chave fictícia 44 dígitos; emitente_uf explícito) ──
  -- 1) ESCRITURADA (lançada + confirmada + lançada a pagar)
  v_chave := '41' || lpad('9000000000000000000000000000000000000001', 42, '0');
  INSERT INTO erp_nfe_recebidas (company_id, chave_acesso, numero, serie, modelo, emitente_cnpj, emitente_razao,
    emitente_uf, natureza_operacao, data_emissao, valor_total, valor_produtos, status, status_manifestacao,
    fornecedor_id, lancado_pagar, manifestado_em, concluida_em, recebida_em, origem, observacoes)
  VALUES (v_bot, v_chave, '1001', '1', '55', v_forn_doc, v_forn_nome, 'PR', 'COMPRA PARA COMERCIALIZACAO',
    (v_hoje - 40)::timestamptz, 4200.00, 4200.00, 'lancada', 'confirmada', v_forn, true,
    (v_hoje - 39)::timestamptz, (v_hoje - 38)::timestamptz, v_hoje - 40, 'seed_demo_ge', 'DEMO-GE-FISCAL nota escriturada');

  -- 2) PENDENTE (XML completo, aguardando lançamento; manifestação pendente)
  v_chave := '41' || lpad('9000000000000000000000000000000000000002', 42, '0');
  INSERT INTO erp_nfe_recebidas (company_id, chave_acesso, numero, serie, modelo, emitente_cnpj, emitente_razao,
    emitente_uf, natureza_operacao, data_emissao, valor_total, valor_produtos, status, status_manifestacao,
    fornecedor_id, lancado_pagar, recebida_em, origem, observacoes)
  VALUES (v_bot, v_chave, '1002', '1', '55', v_forn_doc, v_forn_nome, 'PR', 'COMPRA PARA COMERCIALIZACAO',
    (v_hoje - 8)::timestamptz, 1580.50, 1580.50, 'completa', 'pendente', v_forn, false,
    v_hoje - 8, 'seed_demo_ge', 'DEMO-GE-FISCAL nota pendente de lançamento');

  -- 3) MANIFESTADA (ciência dada, ainda não lançada)
  v_chave := '41' || lpad('9000000000000000000000000000000000000003', 42, '0');
  INSERT INTO erp_nfe_recebidas (company_id, chave_acesso, numero, serie, modelo, emitente_cnpj, emitente_razao,
    emitente_uf, natureza_operacao, data_emissao, valor_total, valor_produtos, status, status_manifestacao,
    fornecedor_id, lancado_pagar, manifestado_em, recebida_em, origem, observacoes)
  VALUES (v_bot, v_chave, '1003', '1', '55', v_forn_doc, v_forn_nome, 'PR', 'COMPRA PARA COMERCIALIZACAO',
    (v_hoje - 3)::timestamptz, 960.00, 960.00, 'completa', 'ciencia', v_forn, false,
    (v_hoje - 2)::timestamptz, v_hoje - 3, 'seed_demo_ge', 'DEMO-GE-FISCAL nota com ciência (manifestada)');

  -- ── NOVO: config do provedor fiscal do Hub (tabela que v_hub_fiscal_cards lê) ──
  -- provider 'focusnfe' (não cai no guard de stub gov_nfse_nacional); ambiente homologação.
  INSERT INTO erp_fiscal_provider_config (company_id, provider, ambiente, ativo,
    serie_nfse_padrao, proxima_numeracao_nfse, serie_nfe_padrao, proxima_numeracao_nfe, regime_tributario)
  SELECT v_bot, 'focusnfe', 'homologacao', true, '1', 108, '1', 215, 'simples_nacional'
  WHERE NOT EXISTS (
    SELECT 1 FROM erp_fiscal_provider_config WHERE company_id = v_bot AND provider = 'focusnfe'
  );
  UPDATE erp_fiscal_provider_config
     SET ambiente='homologacao', ativo=true,
         proxima_numeracao_nfse=GREATEST(proxima_numeracao_nfse, 108),
         proxima_numeracao_nfe=GREATEST(proxima_numeracao_nfe, 215)
   WHERE company_id = v_bot AND provider = 'focusnfe';

  -- ── NOVO: NFS-e/NF-e EMITIDAS (escape de emissão só-demo, transaction-local) ──
  -- origem_tipo='venda' (elo da Jornada 4: faturamento de venda → NF). Linhas do seed são
  -- identificadas por provider_reference LIKE 'seed-demo-ge-%'.
  -- Datas sempre no mês corrente (nunca futuro) para autorizadas_mes/valor_mes saírem de 0.
  v_m1 := LEAST(v_agora - interval '1 hour', date_trunc('month', v_agora) + interval '3 days');
  v_m2 := LEAST(v_agora - interval '1 hour', date_trunc('month', v_agora) + interval '7 days');
  v_m3 := LEAST(v_agora - interval '1 hour', date_trunc('month', v_agora) + interval '11 days');
  v_prev := date_trunc('month', v_agora) - interval '10 days';

  PERFORM set_config('app.permitir_emissao_demo','on',true);

  -- NFS-e (valor_servicos; ISS gravado estático; descricao obrigatória) --------------
  INSERT INTO erp_nfse_emitidas AS t (company_id, provider, provider_reference, ambiente, numero, serie,
    codigo_verificacao, data_emissao, valor_servicos, aliquota_iss, valor_iss, descricao_servico,
    codigo_servico, prestador_cnpj, prestador_razao_social, tomador_cnpj, tomador_razao_social,
    status, motivo_rejeicao, xml_storage_path, data_competencia, origem_tipo)
  VALUES
    (v_bot,'focusnfe','seed-demo-ge-nfse-01','homologacao','101','1','VDEMOA101', v_m1, 1250.00, 5.0, 62.50,
      'Serviço de instalação e assistência técnica — DEMO','1401', v_emit_cnpj, v_razao,
      '04252011000110','Cliente Demonstração Alfa Ltda','autorizada',NULL,
      'demo-ge/nfse/seed-demo-ge-nfse-01.xml', v_m1::date,'venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfse-02','homologacao','102','1','VDEMOA102', v_m2, 3480.00, 5.0, 174.00,
      'Consultoria e suporte mensal — DEMO','1701', v_emit_cnpj, v_razao,
      '19131243000197','Cliente Demonstração Beta ME','autorizada',NULL,
      'demo-ge/nfse/seed-demo-ge-nfse-02.xml', v_m2::date,'venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfse-03','homologacao','103','1','VDEMOA103', v_m3, 920.00, 5.0, 46.00,
      'Manutenção preventiva — DEMO','1401', v_emit_cnpj, v_razao,
      '28111871000133','Cliente Demonstração Gama Ltda','autorizada',NULL,
      NULL, v_m3::date,'venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfse-04','homologacao','98','1','VDEMOA098', v_prev, 2100.00, 5.0, 105.00,
      'Serviço faturado no mês anterior — DEMO','1701', v_emit_cnpj, v_razao,
      '04252011000110','Cliente Demonstração Alfa Ltda','autorizada',NULL,
      'demo-ge/nfse/seed-demo-ge-nfse-04.xml', v_prev::date,'venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfse-05','homologacao',NULL,'1',NULL, v_m3, 640.00, 5.0, 32.00,
      'Serviço em processamento na prefeitura — DEMO','1401', v_emit_cnpj, v_razao,
      '28111871000133','Cliente Demonstração Gama Ltda','processando',NULL,
      NULL, v_m3::date,'venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfse-06','homologacao',NULL,'1',NULL, v_m2, 1780.00, 5.0, 89.00,
      'Serviço rejeitado pela prefeitura — DEMO','1701', v_emit_cnpj, v_razao,
      '19131243000197','Cliente Demonstração Beta ME','rejeitada',
      'Rejeição e-mail do tomador inválido (código 204) — DEMO',
      NULL, v_m2::date,'venda')
  ON CONFLICT (company_id, provider, provider_reference) DO UPDATE SET
    ambiente=EXCLUDED.ambiente, numero=EXCLUDED.numero, serie=EXCLUDED.serie,
    codigo_verificacao=EXCLUDED.codigo_verificacao, data_emissao=EXCLUDED.data_emissao,
    valor_servicos=EXCLUDED.valor_servicos, aliquota_iss=EXCLUDED.aliquota_iss, valor_iss=EXCLUDED.valor_iss,
    descricao_servico=EXCLUDED.descricao_servico, status=EXCLUDED.status, motivo_rejeicao=EXCLUDED.motivo_rejeicao,
    xml_storage_path=EXCLUDED.xml_storage_path, data_competencia=EXCLUDED.data_competencia, atualizado_em=now();

  -- NF-e (valor_total; itens jsonb obrigatório; chave 44 dígitos) ---------------------
  INSERT INTO erp_nfe_emitidas AS t (company_id, provider, provider_reference, ambiente, modelo, serie, numero,
    chave, protocolo, data_emissao, natureza_operacao, finalidade, valor_total, valor_produtos,
    emitente_cnpj, emitente_razao_social, destinatario_cnpj, destinatario_razao_social, itens,
    status, motivo_rejeicao, xml_storage_path, origem_tipo)
  VALUES
    (v_bot,'focusnfe','seed-demo-ge-nfe-01','homologacao','55','1','201',
      '41'||lpad('7000000000000000000000000000000000000201',42,'0'),'141250000000201', v_m1,
      'VENDA DE MERCADORIA','normal', 5600.00, 5600.00, v_emit_cnpj, v_razao,
      '04252011000110','Cliente Demonstração Alfa Ltda',
      '[{"descricao":"Produto demo A","ncm":"84713012","quantidade":2,"valor_unitario":2800.00,"valor_total":5600.00}]'::jsonb,
      'autorizada',NULL,'demo-ge/nfe/seed-demo-ge-nfe-01.xml','venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfe-02','homologacao','55','1','202',
      '41'||lpad('7000000000000000000000000000000000000202',42,'0'),'141250000000202', v_m2,
      'VENDA DE MERCADORIA','normal', 2950.00, 2950.00, v_emit_cnpj, v_razao,
      '19131243000197','Cliente Demonstração Beta ME',
      '[{"descricao":"Produto demo B","ncm":"85176259","quantidade":5,"valor_unitario":590.00,"valor_total":2950.00}]'::jsonb,
      'autorizada',NULL,'demo-ge/nfe/seed-demo-ge-nfe-02.xml','venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfe-03','homologacao','55','1','198',
      '41'||lpad('7000000000000000000000000000000000000198',42,'0'),'141250000000198', v_prev,
      'VENDA DE MERCADORIA','normal', 8300.00, 8300.00, v_emit_cnpj, v_razao,
      '28111871000133','Cliente Demonstração Gama Ltda',
      '[{"descricao":"Produto demo C","ncm":"94036000","quantidade":10,"valor_unitario":830.00,"valor_total":8300.00}]'::jsonb,
      'autorizada',NULL,'demo-ge/nfe/seed-demo-ge-nfe-03.xml','venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfe-04','homologacao','55','1',NULL,
      NULL,NULL, v_m3,
      'VENDA DE MERCADORIA','normal', 1200.00, 1200.00, v_emit_cnpj, v_razao,
      '04252011000110','Cliente Demonstração Alfa Ltda',
      '[{"descricao":"Produto demo D","ncm":"84713012","quantidade":1,"valor_unitario":1200.00,"valor_total":1200.00}]'::jsonb,
      'processando',NULL,NULL,'venda'),
    (v_bot,'focusnfe','seed-demo-ge-nfe-05','homologacao','55','1',NULL,
      NULL,NULL, v_m2,
      'VENDA DE MERCADORIA','normal', 3400.00, 3400.00, v_emit_cnpj, v_razao,
      '19131243000197','Cliente Demonstração Beta ME',
      '[{"descricao":"Produto demo E","ncm":"85176259","quantidade":4,"valor_unitario":850.00,"valor_total":3400.00}]'::jsonb,
      'rejeitada','Rejeição 609: Chave de acesso com dígito verificador inválido — DEMO',NULL,'venda')
  ON CONFLICT (company_id, provider, provider_reference) DO UPDATE SET
    ambiente=EXCLUDED.ambiente, numero=EXCLUDED.numero, chave=EXCLUDED.chave, protocolo=EXCLUDED.protocolo,
    data_emissao=EXCLUDED.data_emissao, valor_total=EXCLUDED.valor_total, valor_produtos=EXCLUDED.valor_produtos,
    itens=EXCLUDED.itens, status=EXCLUDED.status, motivo_rejeicao=EXCLUDED.motivo_rejeicao,
    xml_storage_path=EXCLUDED.xml_storage_path, atualizado_em=now();

  PERFORM set_config('app.permitir_emissao_demo','off',true);

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'fiscal',
    'perfil', (SELECT jsonb_build_object('regime', regime, 'anexo', simples_anexo)
                 FROM fiscal_configuracao WHERE company_id=v_bot),
    'nfe_recebidas', (SELECT count(*) FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge'),
    'por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge' GROUP BY status) s),
    'por_manifestacao', (SELECT jsonb_object_agg(status_manifestacao, n) FROM
       (SELECT status_manifestacao, count(*) n FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge' GROUP BY status_manifestacao) s),
    'lancadas_a_pagar', (SELECT count(*) FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge' AND lancado_pagar),
    'provider_config', (SELECT jsonb_build_object('ativo', ativo, 'ambiente', ambiente)
                          FROM erp_fiscal_provider_config WHERE company_id=v_bot AND provider='focusnfe'),
    'nfse_emitidas', (SELECT count(*) FROM erp_nfse_emitidas WHERE company_id=v_bot AND provider_reference LIKE 'seed-demo-ge-%'),
    'nfe_emitidas', (SELECT count(*) FROM erp_nfe_emitidas WHERE company_id=v_bot AND provider_reference LIKE 'seed-demo-ge-%')
  );
END $function$;

-- Reaplica o seed agora para a DEMO GE já nascer com o Hub Fiscal populado.
SELECT public.fn_demo_seed_ge_fiscal('b0700000-0000-4000-a000-000000000004');

-- ACL da função SECURITY DEFINER recriada (check_fn_guards regra 1): espelha a ACL viva
-- (só service_role — seed de sistema; anon/PUBLIC/authenticated revogados).
REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_fiscal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_fiscal(uuid) TO service_role;
