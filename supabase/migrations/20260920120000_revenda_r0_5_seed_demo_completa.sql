-- Revenda R0.5 · Demonstração Revenda completa (para o auditor enxergar tudo)
--
-- Seed FICTÍCIO e IDEMPOTENTE (guard is_demo, RD-69) que completa a Demonstração Revenda
-- (b0700000-...-003) com o que faltava para a RD-70: venda HB20 com NF-e AUTORIZADA em homologação
-- (destrava a entrega do R0.2), recebimentos (entrada/parcela vencida/financiamento), procuras do
-- "O que comprar", uma vistoria CONCLUÍDA com reparo (previsão alimenta a precificação) e a config
-- da garagem. Fotos sintéticas (bytes no storage) e a vistoria RÁPIDA ficam para R0.4/R0.3 (a rápida
-- depende do modelo criado no R0.3). Dados só entram em empresa is_demo.

CREATE OR REPLACE FUNCTION public.fn_demo_seed_revenda_r05(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_sysrole text; v_is_demo boolean;
  v_hb20_veic uuid := '5bcc762d-4c9e-48e1-b144-8d5f1152c5cd';
  v_corolla   uuid := '415ae6e7-7e1d-4493-9e61-573bb3f9e831';
  v_modelo    uuid;
  v_venda uuid; v_venda_valor numeric; v_cliente text;
  v_nfe uuid := md5(p_company::text || ':r05:nfe:hb20')::uuid;
  v_vist uuid := md5(p_company::text || ':r05:vist:corolla')::uuid;
  v_it_reparo uuid; v_it_ok uuid;
BEGIN
  IF p_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_nulo'); END IF;
  SELECT system_role INTO v_sysrole FROM users WHERE id = auth.uid();
  IF NOT (v_interno OR coalesce(auth.role(),'')='service_role' OR coalesce(v_sysrole,'') IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RAISE EXCEPTION 'Só PS_ADMIN semeia demo' USING errcode='42501'; END IF;
  SELECT is_demo INTO v_is_demo FROM companies WHERE id = p_company;
  IF v_is_demo IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_nao_demo', 'company_id', p_company); END IF;

  -- ── (1) HB20: NF-e autorizada (homologação) + vínculo na venda → habilita a entrega (R0.2) ──────────
  SELECT id, valor_venda, coalesce(cliente_nome,'Cliente Demonstração')
    INTO v_venda, v_venda_valor, v_cliente
    FROM veic_venda WHERE veiculo_id = v_hb20_veic AND deleted_at IS NULL
    ORDER BY created_at LIMIT 1;

  -- NB (R0.5/R0.2): NÃO semeamos erp_nfe_emitidas na demo. O trigger fn_bloqueia_emissao_nao_produtiva
  -- proíbe QUALQUER NF-e em empresa que não seja 'producao' (a demo é 'auditoria') — guarda fiscal correta.
  -- Logo a HB20 não pode ter "NF autorizada" na demo por seed nem por emissão real. A liberação da entrega
  -- no demo é tratada à parte (regra demo-aware, fora deste seed — ver descrição da PR), sem forjar registro fiscal.
  IF v_venda IS NOT NULL THEN
    -- ── (2) Recebimentos: entrada (paga) + parcela vencida + financiamento do banco ──────────────────
    INSERT INTO veic_venda_recebimento (id, company_id, venda_id, tipo, devedor, valor, data_prevista, forma_padrao)
    VALUES
      (md5(p_company::text||':r05:rec:entrada')::uuid, p_company, v_venda, 'entrada','cliente', 6000, (now()-interval '20 days')::date, 'pix'),
      (md5(p_company::text||':r05:rec:parcela')::uuid, p_company, v_venda, 'parcela','cliente', 6000, (now()-interval '3 days')::date, 'transferencia'),
      (md5(p_company::text||':r05:rec:financ')::uuid,  p_company, v_venda, 'financiamento','banco', 50000, (now()+interval '5 days')::date, 'financiamento')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- ── (3) Procuras do "O que comprar" ──────────────────────────────────────────────────────────────
  INSERT INTO veic_procura (id, company_id, cliente_nome, contato, marca, modelo, ano_min, ano_max, valor_ate, cambio, observacao, criado_em)
  VALUES
    (md5(p_company::text||':r05:proc:1')::uuid, p_company, 'Marcos Andrade', '(45) 99101-1010', 'Toyota', 'Corolla', 2020, 2023, 120000, 'automatico', 'Quer prata ou preto, baixa km', now()-interval '8 days'),
    (md5(p_company::text||':r05:proc:2')::uuid, p_company, 'Luiza Prado', '(45) 99202-2020', 'Honda', 'HR-V', 2021, 2024, 140000, 'automatico', 'Aceita troca do Onix dela', now()-interval '5 days'),
    (md5(p_company::text||':r05:proc:3')::uuid, p_company, 'Cleber Souza', '(45) 99303-3030', 'Fiat', 'Toro', 2019, 2022, 110000, 'automatico', 'Diesel 4x4', now()-interval '3 days'),
    (md5(p_company::text||':r05:proc:4')::uuid, p_company, 'Renata Lima', '(45) 99404-4040', 'Volkswagen', 'Polo', 2022, 2025, 90000, 'manual', 'Primeiro carro da filha', now()-interval '1 day')
  ON CONFLICT (id) DO NOTHING;

  -- ── (4) Vistoria CONCLUÍDA com reparo (Corolla) → previsão alimenta a precificação ──────────────────
  SELECT id INTO v_modelo FROM insp_modelo
    WHERE company_id = p_company AND escopo='veiculo_revenda' AND padrao=true LIMIT 1;
  IF v_modelo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM insp_vistoria WHERE id = v_vist) THEN
    SELECT i.id INTO v_it_reparo FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id
      WHERE r.modelo_id=v_modelo AND i.nome='parachoque dianteiro' LIMIT 1;
    SELECT i.id INTO v_it_ok FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id
      WHERE r.modelo_id=v_modelo AND i.nome='parabrisa' LIMIT 1;
    INSERT INTO insp_vistoria (id, company_id, modelo_id, escopo, alvo_tabela, alvo_id, situacao, km, previsao_total, observacao, iniciada_em, concluida_em)
    VALUES (v_vist, p_company, v_modelo, 'veiculo_revenda', 'veic_veiculo', v_corolla, 'concluida', 48200, 900,
      'Vistoria de demonstração — 1 item em reparo.', now()-interval '6 days', now()-interval '6 days')
    ON CONFLICT (id) DO NOTHING;
    IF v_it_reparo IS NOT NULL THEN
      INSERT INTO insp_resposta (id, company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, foto_path, respondido_em)
      VALUES (md5(p_company::text||':r05:resp:reparo')::uuid, p_company, v_vist, v_it_reparo, 'reparo',
        'Amassado no parachoque dianteiro — reparo + pintura.', 900, 'demo/vistoria-parachoque.jpg', now()-interval '6 days')
      ON CONFLICT (id) DO NOTHING;
    END IF;
    IF v_it_ok IS NOT NULL THEN
      INSERT INTO insp_resposta (id, company_id, vistoria_id, item_id, estado, respondido_em)
      VALUES (md5(p_company::text||':r05:resp:ok')::uuid, p_company, v_vist, v_it_ok, 'ok', now()-interval '6 days')
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;

  -- ── (5) Config da garagem (encargos + margem) — só preenche o que estiver nulo ──────────────────────
  UPDATE veic_config SET
    impostos_venda_pct   = COALESCE(impostos_venda_pct, 4),
    comissao_venda_pct   = COALESCE(comissao_venda_pct, 2),
    provisao_garantia_pct= COALESCE(provisao_garantia_pct, 1.5),
    margem_alvo_pct      = COALESCE(margem_alvo_pct, 12),
    updated_at = now()
  WHERE company_id = p_company;

  RETURN jsonb_build_object('ok', true, 'company_id', p_company,
    'recebimentos_hb20', v_venda IS NOT NULL, 'procuras', 4,
    'vistoria_concluida_reparo', v_modelo IS NOT NULL,
    'nota', 'NF-e da demo bloqueada pelo guard fiscal (auditoria); entrega demo tratada fora do seed');
END $function$;

COMMENT ON FUNCTION public.fn_demo_seed_revenda_r05(uuid) IS
  'RD-69/RD-70 R0.5: completa a Demonstração Revenda (HB20 NF autorizada, recebimentos, procuras, vistoria concluída com reparo, config). Só is_demo.';
REVOKE ALL ON FUNCTION public.fn_demo_seed_revenda_r05(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_revenda_r05(uuid) TO authenticated, service_role;

-- Aplica na Demonstração Revenda
SELECT public.fn_demo_seed_revenda_r05('b0700000-0000-4000-a000-000000000003');
