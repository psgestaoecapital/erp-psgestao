-- GE · Onda G0e · Demonstração Comércio GE — FISCAL (Bloco 5 do seed, RD-69).
-- Sub-seed fn_demo_seed_ge_fiscal(company) encadeado no braço 004 do fn_demo_reset,
-- após cadastros (G0a) + comercial (G0b) + financeiro (G0c) + bancos (G0d). Só a empresa
-- demo, SECURITY DEFINER + REVOKE anon, 100% fictício, idempotente e determinístico.
--
-- Conteúdo:
--   • 1 PERFIL fiscal (fiscal_configuracao) — regime Simples, anexo I (comércio), alíquotas padrão;
--   • 3 NF-e RECEBIDAS (erp_nfe_recebidas) cobrindo os 3 estados de escrituração/manifestação:
--       - ESCRITURADA  → status='lancada'  + manifestação 'confirmada' + lançada a pagar;
--       - PENDENTE      → status='completa' + manifestação 'pendente'   (aguardando lançar);
--       - MANIFESTADA   → status='completa' + manifestação 'ciencia'    (ciência dada, não lançada).
--
-- NF-e RECEBIDA é entrada/escrituração do destinatário — NÃO é emissão. A trava
-- trg_bloqueia_emissao_demo age só em erp_nfe_emitidas/erp_nfse_emitidas/erp_remessa_pagamento,
-- então recebidas são permitidas na empresa demo. O DELETE físico do reset usa o escape auditado
-- app.permitir_delete_fisico (RD-30), igual ao financeiro. Marcador: origem='seed_demo_ge'.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_fiscal(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_forn uuid; v_forn_nome text; v_forn_doc text;
  v_hoje date := CURRENT_DATE;
  v_chave text;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge'); END IF;

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

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'fiscal',
    'perfil', (SELECT jsonb_build_object('regime', regime, 'anexo', simples_anexo)
                 FROM fiscal_configuracao WHERE company_id=v_bot),
    'nfe_recebidas', (SELECT count(*) FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge'),
    'por_status', (SELECT jsonb_object_agg(status, n) FROM
       (SELECT status, count(*) n FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge' GROUP BY status) s),
    'por_manifestacao', (SELECT jsonb_object_agg(status_manifestacao, n) FROM
       (SELECT status_manifestacao, count(*) n FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge' GROUP BY status_manifestacao) s),
    'lancadas_a_pagar', (SELECT count(*) FROM erp_nfe_recebidas WHERE company_id=v_bot AND origem='seed_demo_ge' AND lancado_pagar)
  );
END $function$;

-- fn_demo_reset: no braço 004, encadeia fiscal (Bloco 5) após cadastros+comercial+financeiro+bancos.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb;
  v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb; v_fis jsonb;
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
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_fiscal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_fiscal(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid)          TO authenticated, service_role;
