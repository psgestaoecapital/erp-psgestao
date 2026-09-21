-- Revenda · Perfil Fiscal — amplia o modelo com as respostas reais do contador (Alliance, ctx 27f9379c).
-- ADITIVO (RD-55). Nada de regra fiscal fixa em código: tudo por empresa/operação/vigência (Pilar 1).
-- A NF lê CFOP/CST/cBenef/redução/IBS-CBS/texto/natureza da tabela de operações (RD-65). Guarda por empresa.
--
-- ESCOPO deste PR (banco/fundação): (1) colunas fiscais por operação + operação consignacao_saida_fora_uf;
-- (2) modelo de comissão de vendedor (regra por tipo de atendimento) + calculadora; (3) FIPE por veículo
-- (informada à mão, D7) com selo de frescor; (4) NCM por veículo + sugestão por tipo/cilindradas + NCM
-- padrão da empresa; (5) limite de espécie do perfil alimentando o COAF da negociação. Semeia um perfil
-- Presumido/SC de DEMONSTRAÇÃO (RD-69) com os valores do contador.
-- FOLLOW-UP (fora deste PR, exige decisão de fórmula): consumir a comissão por atendimento dentro de
-- fn_veic_preco_minimo/conta_do_carro/acerto — hoje o preço resolve "por dentro" com encargos em % do
-- PREÇO; uma comissão FIXA (R$/atendimento) ou sobre FIPE muda a fórmula central e será tratada à parte.

-- ── (1) colunas fiscais por operação ────────────────────────────────────────────────────────────
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS cbenef text;
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS cst_icms text;                       -- separado do CSOSN
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS reducao_base_icms_pct numeric;
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS reducao_base_icms_base_legal text;
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS ibs_cbs_cst text;
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS ibs_cbs_cclasstrib text;
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS inf_complementar_texto text;         -- texto obrigatório da nota
ALTER TABLE veic_perfil_fiscal_operacao ADD COLUMN IF NOT EXISTS natureza_operacao text;

-- operação: acrescenta 'consignacao_saida_fora_uf' (devolucao_venda já existe).
ALTER TABLE veic_perfil_fiscal_operacao DROP CONSTRAINT IF EXISTS veic_perfil_fiscal_operacao_operacao_check;
ALTER TABLE veic_perfil_fiscal_operacao ADD CONSTRAINT veic_perfil_fiscal_operacao_operacao_check
  CHECK (operacao = ANY (ARRAY['compra_pf','compra_pj','venda','troca_entrada','consignacao_entrada',
    'consignacao_venda','consignacao_saida_fora_uf','consignacao_retorno','devolucao_venda']));

-- ── (3)+(4) FIPE e NCM por veículo ──────────────────────────────────────────────────────────────
ALTER TABLE veic_veiculo ADD COLUMN IF NOT EXISTS valor_fipe numeric;
ALTER TABLE veic_veiculo ADD COLUMN IF NOT EXISTS valor_fipe_informado_em timestamptz;
ALTER TABLE veic_veiculo ADD COLUMN IF NOT EXISTS valor_fipe_informado_por uuid;
ALTER TABLE veic_veiculo ADD COLUMN IF NOT EXISTS ncm text;

-- NCM padrão da empresa (só sugestão; o NCM que vale é o do veículo).
ALTER TABLE veic_perfil_fiscal ADD COLUMN IF NOT EXISTS ncm_padrao text;

-- ── (2) modelo de comissão de vendedor por tipo de atendimento ──────────────────────────────────
CREATE TABLE IF NOT EXISTS veic_comissao_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo_atendimento text NOT NULL,                         -- 'trouxe_venda' | 'atendeu_na_loja' | ...
  base text NOT NULL CHECK (base IN ('fipe','preco','lucro','fixo')),
  percentual numeric,                                     -- quando base ∈ (fipe,preco,lucro)
  valor_fixo numeric,                                     -- quando base = 'fixo'
  rotulo text,
  ativo boolean NOT NULL DEFAULT true,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_comissao_regra ON veic_comissao_regra(company_id, tipo_atendimento);
ALTER TABLE veic_comissao_regra ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.veic_comissao_regra'::regclass AND polname='veic_comissao_regra_rw') THEN
    CREATE POLICY veic_comissao_regra_rw ON veic_comissao_regra FOR ALL
      USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_comissao_regra TO authenticated;
GRANT ALL ON public.veic_comissao_regra TO service_role;

-- fn_veic_comissao_calcular(veiculo, tipo, preco, lucro) → valor da comissão ou nao_configurado (RD-51).
CREATE OR REPLACE FUNCTION public.fn_veic_comissao_calcular(p_veiculo_id uuid, p_tipo_atendimento text, p_preco numeric DEFAULT NULL, p_lucro numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; r record; v_fipe numeric; v_valor numeric; v_status text := 'ok';
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT * INTO r FROM veic_comissao_regra WHERE company_id=v_comp AND tipo_atendimento=p_tipo_atendimento AND ativo LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 'nao_configurado', 'tipo_atendimento', p_tipo_atendimento); END IF;
  SELECT valor_fipe INTO v_fipe FROM veic_veiculo WHERE id=p_veiculo_id;
  IF r.base='fixo' THEN
    v_valor := r.valor_fixo; IF v_valor IS NULL THEN v_status:='nao_configurado'; END IF;
  ELSIF r.base='fipe' THEN
    IF v_fipe IS NULL OR r.percentual IS NULL THEN v_status:='nao_configurado'; ELSE v_valor := round(v_fipe * r.percentual/100.0, 2); END IF;
  ELSIF r.base='preco' THEN
    IF p_preco IS NULL OR r.percentual IS NULL THEN v_status:='nao_configurado'; ELSE v_valor := round(p_preco * r.percentual/100.0, 2); END IF;
  ELSIF r.base='lucro' THEN
    IF p_lucro IS NULL OR r.percentual IS NULL THEN v_status:='nao_configurado'; ELSE v_valor := round(p_lucro * r.percentual/100.0, 2); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', v_status, 'tipo_atendimento', p_tipo_atendimento,
    'base', r.base, 'percentual', r.percentual, 'valor_fixo', r.valor_fixo, 'fipe', v_fipe, 'valor', CASE WHEN v_status='ok' THEN v_valor ELSE NULL END);
END $function$;
REVOKE ALL ON FUNCTION public.fn_veic_comissao_calcular(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_comissao_calcular(uuid, text, numeric, numeric) TO authenticated, service_role;

-- ── (4) sugestão de NCM por tipo + cilindradas (editável no veículo; o perfil guarda o padrão) ──────
CREATE OR REPLACE FUNCTION public.fn_veic_ncm_sugerido(p_tipo text, p_cilindradas numeric)
 RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN p_tipo ILIKE '%moto%' OR p_tipo ILIKE '%motoc%' THEN
      CASE WHEN COALESCE(p_cilindradas,0) <= 250 THEN '87112010' ELSE '87113000' END
    WHEN COALESCE(p_cilindradas,0) = 0 THEN '87032210'                                  -- padrão carro (sem cilindrada informada)
    WHEN p_cilindradas <= 1000 THEN '87032100'
    WHEN p_cilindradas <= 1500 THEN '87032210'                                          -- carro 1.000–1.500 cc (padrão Alliance)
    WHEN p_cilindradas <= 3000 THEN '87032310'
    ELSE '87032410' END
$function$;

-- ── (1) fn_veic_perfil_operacao — a NF lê TUDO daqui (agora com as colunas novas) ──────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_operacao(p_company_id uuid, p_operacao text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_perfil uuid; o record; v jsonb;
BEGIN
  v := fn_veic_perfil_fiscal_vigente(p_company_id);
  IF (v->>'status') <> 'aprovado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'perfil_fiscal_nao_aprovado'); END IF;
  v_perfil := (v->>'perfil_id')::uuid;
  SELECT * INTO o FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_perfil AND operacao = p_operacao;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'operacao_nao_configurada', 'operacao', p_operacao,
      'mensagem', 'Esta operação não tem CFOP/CST no perfil fiscal aprovado — complete o perfil com o contador.'); END IF;
  RETURN jsonb_build_object('ok', true, 'operacao', o.operacao,
    'cfop_dentro_uf', o.cfop_dentro_uf, 'cfop_fora_uf', o.cfop_fora_uf, 'cst_ou_csosn', o.cst_ou_csosn,
    'emite_nota_entrada', o.emite_nota_entrada,
    'cbenef', o.cbenef, 'cst_icms', o.cst_icms,
    'reducao_base_icms_pct', o.reducao_base_icms_pct, 'reducao_base_icms_base_legal', o.reducao_base_icms_base_legal,
    'ibs_cbs_cst', o.ibs_cbs_cst, 'ibs_cbs_cclasstrib', o.ibs_cbs_cclasstrib,
    'inf_complementar_texto', o.inf_complementar_texto, 'natureza_operacao', o.natureza_operacao);
END $function$;

-- ── (5) COAF da negociação usa o limite do PERFIL vigente (cai para o veic_config se não houver) ────
--    Corpo idêntico ao R5a, trocando só a origem do limite de espécie.
CREATE OR REPLACE FUNCTION public.fn_veic_negociacao_simular(p_neg_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  n record; cfg record; v_conta jsonb; v_perfil_lim numeric; v_lim_coaf numeric;
  v_custo_real numeric; v_enc numeric; v_preco_final numeric; v_sobrepreco numeric; v_lucro numeric;
  v_margem_pct numeric; v_desc_pct numeric; v_alcada text; v_coaf text; v_recebe_cliente numeric; v_recebe_banco numeric;
BEGIN
  SELECT * INTO n FROM veic_negociacao WHERE id = p_neg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'negociacao_nao_encontrada'); END IF;
  IF NOT (n.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT margem_minima_pct, desconto_max_pct, coaf_limite_especie INTO cfg FROM veic_config WHERE company_id = n.company_id;
  -- limite de espécie: o do perfil fiscal aprovado (pergunta 14) tem precedência; senão o do veic_config.
  SELECT coaf_limite_especie INTO v_perfil_lim FROM veic_perfil_fiscal
    WHERE id = NULLIF(fn_veic_perfil_fiscal_vigente(n.company_id)->>'perfil_id','')::uuid;
  v_lim_coaf := COALESCE(v_perfil_lim, cfg.coaf_limite_especie);

  v_conta := fn_veic_conta_do_carro(n.veiculo_id);
  v_custo_real := NULLIF(v_conta->>'custo_real_total','')::numeric;
  v_enc := COALESCE(NULLIF(v_conta->>'encargos_pct','')::numeric, 0) / 100.0;
  v_preco_final := COALESCE(n.preco_pedido,0) - COALESCE(n.desconto,0);
  v_sobrepreco := CASE WHEN n.troca_valor_dado IS NOT NULL AND n.troca_avaliacao IS NOT NULL
                       THEN n.troca_valor_dado - n.troca_avaliacao ELSE 0 END;
  v_lucro := CASE WHEN v_custo_real IS NULL THEN NULL
                  ELSE round(v_preco_final*(1-v_enc) - v_custo_real - v_sobrepreco + COALESCE(n.retorno_banco,0), 2) END;
  v_margem_pct := CASE WHEN v_custo_real IS NOT NULL AND v_custo_real > 0 AND v_lucro IS NOT NULL
                       THEN round(v_lucro / v_custo_real * 100, 2) END;
  v_desc_pct := CASE WHEN COALESCE(n.preco_pedido,0) > 0 THEN round(COALESCE(n.desconto,0)/n.preco_pedido*100, 2) ELSE 0 END;

  v_alcada := CASE
    WHEN cfg.desconto_max_pct IS NOT NULL AND v_desc_pct > cfg.desconto_max_pct THEN 'exige_aprovacao'
    WHEN cfg.margem_minima_pct IS NOT NULL AND v_margem_pct IS NOT NULL AND v_margem_pct < cfg.margem_minima_pct THEN 'exige_aprovacao'
    ELSE 'ok' END;
  v_coaf := CASE
    WHEN v_lim_coaf IS NULL THEN 'nao_configurado'
    WHEN COALESCE(n.especie_valor,0) > v_lim_coaf THEN 'alerta'
    ELSE 'ok' END;

  v_recebe_cliente := COALESCE(n.entrada,0) + (v_preco_final - COALESCE(n.entrada,0) - COALESCE(n.financiado,0));
  v_recebe_banco := COALESCE(n.financiado,0) + COALESCE(n.retorno_banco,0);

  RETURN jsonb_build_object('ok', true, 'estado', n.estado,
    'preco_pedido', n.preco_pedido, 'desconto', n.desconto, 'preco_final', v_preco_final,
    'desconto_pct', v_desc_pct, 'sobrepreco_troca', v_sobrepreco,
    'custo_real', v_custo_real, 'encargos_pct', NULLIF(v_conta->>'encargos_pct','')::numeric,
    'lucro_real', v_lucro, 'margem_pct', v_margem_pct,
    'margem_minima_pct', cfg.margem_minima_pct, 'desconto_max_pct', cfg.desconto_max_pct,
    'alcada', v_alcada,
    'coaf', jsonb_build_object('status', v_coaf, 'especie', n.especie_valor, 'limite', v_lim_coaf,
      'fonte_limite', CASE WHEN v_perfil_lim IS NOT NULL THEN 'perfil_fiscal' WHEN cfg.coaf_limite_especie IS NOT NULL THEN 'config' ELSE 'nenhuma' END),
    'em_linguagem_de_dono', jsonb_build_object(
      'o_cliente_paga', v_preco_final, 'voce_recebe_do_cliente', v_recebe_cliente,
      'voce_recebe_do_banco', v_recebe_banco, 'a_troca_embutiu_desconto', v_sobrepreco));
END $function$;

-- ── SEED (RD-69): perfil Presumido/SC de DEMONSTRAÇÃO com as respostas do contador (fictício da demo) ──
CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_fiscal_alliance(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_bot uuid := 'b0700000-0000-4000-a000-000000000003'; v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_perfil uuid; v_onix uuid; v_cb uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;

  -- limite de espécie e comissão da demo (pergunta 13/14 do contador)
  UPDATE veic_config SET coaf_limite_especie = 30000, updated_at = now() WHERE company_id = v_bot;
  DELETE FROM veic_comissao_regra WHERE company_id = v_bot;
  INSERT INTO veic_comissao_regra (company_id, tipo_atendimento, base, percentual, valor_fixo, rotulo, ordem) VALUES
    (v_bot, 'trouxe_venda',    'fipe', 1,    NULL, 'Trouxe a venda — 1% da FIPE', 1),
    (v_bot, 'atendeu_na_loja', 'fixo', NULL, 350,  'Atendeu na loja — R$ 350 fixo', 2);

  -- perfil fiscal APROVADO de demonstração (Presumido/SC) — reset determinístico.
  PERFORM set_config('app.perfil_fiscal_transicao', 'on', true);
  DELETE FROM veic_perfil_fiscal_operacao WHERE company_id = v_bot;
  DELETE FROM veic_perfil_fiscal WHERE company_id = v_bot;
  INSERT INTO veic_perfil_fiscal (company_id, versao, status, vigente_desde, preenchido_por, aprovado_por, aprovado_em,
    regime, icms_saida_regra, icms_saida_pct, icms_saida_base_legal, coaf_responsavel, coaf_limite_especie, ncm_padrao,
    reforma_tratamento, comissao_base, observacao, criado_por)
  VALUES (v_bot, 1, 'aprovado', current_date - 30, 'contador', v_robo, now() - interval '30 days',
    'presumido', 'base_reduzida', 5, 'art. 8º, II, Anexo 2, RICMS-SC/01 (Conv. ICMS 15/81) — base reduzida 95%',
    'Responsável fiscal', 30000, '87032210', 'venda normal como as outras (não muda)', 'lucro',
    'Perfil de DEMONSTRAÇÃO com base nas respostas do contador da Alliance (fictício).', v_robo)
  RETURNING id INTO v_perfil;

  INSERT INTO veic_perfil_fiscal_operacao (perfil_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn,
    cst_icms, reducao_base_icms_pct, reducao_base_icms_base_legal, cbenef, ibs_cbs_cst, ibs_cbs_cclasstrib,
    inf_complementar_texto, natureza_operacao, emite_nota_entrada) VALUES
    (v_perfil, v_bot, 'compra_pf', '1102', '2102', NULL, '041', NULL, NULL, 'SC999999', '410', '410017', NULL, 'Compra de veículo usado de pessoa física', true),
    (v_perfil, v_bot, 'compra_pj', '1102', '2102', NULL, '041', NULL, NULL, 'SC999999', '410', '410017', NULL, 'Compra de veículo usado', true),
    (v_perfil, v_bot, 'venda', '5102', '6102', NULL, '041', 95, 'art. 8º, II, Anexo 2, RICMS-SC/01 (Conv. ICMS 15/81)', 'SC820019', '410', '410017', 'ICMS com base reduzida em 95% (veículo usado) — art. 8º, II, Anexo 2, RICMS-SC/01.', 'Venda de veículo usado', false),
    (v_perfil, v_bot, 'consignacao_entrada', '1949', NULL, NULL, '041', NULL, NULL, 'SC999999', '410', '410999', 'Veículo recebido de terceiro para fins de intermediação/agenciamento de venda, mediante contrato de comissão.', 'Recebimento de veículo de terceiro em consignação/comissão', true),
    (v_perfil, v_bot, 'consignacao_venda', '5949', '6949', NULL, '041', NULL, NULL, 'SC820019', '410', '410999', 'Venda por conta e ordem — consignação.', 'Venda de veículo em consignação', false),
    (v_perfil, v_bot, 'consignacao_saida_fora_uf', NULL, '6949', NULL, '041', NULL, NULL, 'SC820019', '410', '410999', 'Saída em consignação para fora do estado (CFOP a confirmar).', 'Consignação — saída fora do estado', false),
    (v_perfil, v_bot, 'devolucao_venda', '1202', '2202', NULL, '041', NULL, NULL, NULL, '410', '410017', 'Devolução de venda de veículo usado.', 'Devolução de venda', true)
  ON CONFLICT (perfil_id, operacao) DO NOTHING;

  -- FIPE informada + NCM em dois veículos (carro e moto) — RD-51: sem FIPE, comissão sobre FIPE fica nao_configurado.
  SELECT id INTO v_onix FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00003' LIMIT 1;
  SELECT id INTO v_cb   FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00010' LIMIT 1;  -- CB 500 (moto)
  IF v_onix IS NOT NULL THEN
    UPDATE veic_veiculo SET valor_fipe = 47000, valor_fipe_informado_em = now() - interval '3 days', valor_fipe_informado_por = v_robo,
      ncm = fn_veic_ncm_sugerido('carro', cilindradas) WHERE id = v_onix;
  END IF;
  IF v_cb IS NOT NULL THEN
    UPDATE veic_veiculo SET valor_fipe = 34000, valor_fipe_informado_em = now() - interval '3 days', valor_fipe_informado_por = v_robo,
      ncm = fn_veic_ncm_sugerido('moto', COALESCE(cilindradas, 500)) WHERE id = v_cb;
  END IF;

  RETURN jsonb_build_object('ok', true, 'perfil', v_perfil,
    'operacoes', (SELECT count(*) FROM veic_perfil_fiscal_operacao WHERE perfil_id=v_perfil),
    'comissao_regras', (SELECT count(*) FROM veic_comissao_regra WHERE company_id=v_bot));
END $function$;

-- RD-69: liga o seed fiscal ao fim do seed da precificação (já na cadeia do seed único).
CREATE OR REPLACE FUNCTION public.fn_gold_revenda_seed_precificacao(p_company uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000003'; v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_onix uuid; v_modelo uuid; v_vist uuid; v_it1 uuid; v_it2 uuid; v_prev numeric; v_onix2 uuid; v_onix3 uuid;
BEGIN
  IF p_company <> v_bot THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo'); END IF;
  SELECT id INTO v_onix FROM veic_veiculo WHERE company_id=v_bot AND chassi='DEMO0REVENDA00003' LIMIT 1;
  SELECT id INTO v_modelo FROM insp_modelo WHERE company_id=v_bot AND escopo='veiculo_revenda' AND nome ILIKE '%rápida%' LIMIT 1;
  IF v_modelo IS NULL THEN SELECT id INTO v_modelo FROM insp_modelo WHERE company_id=v_bot AND escopo='veiculo_revenda' LIMIT 1; END IF;
  DELETE FROM insp_resposta WHERE company_id=v_bot;
  DELETE FROM insp_vistoria WHERE company_id=v_bot AND escopo='veiculo_revenda';
  DELETE FROM veic_avaliacao_recusa WHERE company_id=v_bot;
  DELETE FROM veic_veiculo WHERE company_id=v_bot AND chassi IN ('DEMO0REVENDA0ONIX2','DEMO0REVENDA0ONIX3');
  IF v_onix IS NOT NULL AND v_modelo IS NOT NULL THEN
    SELECT i.id INTO v_it1 FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id WHERE r.modelo_id=v_modelo ORDER BY r.ordem, i.ordem LIMIT 1;
    SELECT i.id INTO v_it2 FROM insp_item i JOIN insp_regiao r ON r.id=i.regiao_id WHERE r.modelo_id=v_modelo AND i.id <> v_it1 ORDER BY r.ordem, i.ordem OFFSET 1 LIMIT 1;
    IF v_it1 IS NOT NULL THEN
      INSERT INTO insp_vistoria (company_id, modelo_id, escopo, alvo_tabela, alvo_id, situacao, km, previsao_total, observacao, iniciada_em, concluida_em, criado_por)
      VALUES (v_bot, v_modelo, 'veiculo_revenda', 'veic_veiculo', v_onix, 'concluida', 38000, 0, 'Vistoria de entrada (demo).', now()-interval '40 days', now()-interval '39 days', v_robo)
      RETURNING id INTO v_vist;
      INSERT INTO insp_resposta (company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, respondido_por, respondido_em)
      VALUES (v_bot, v_vist, v_it1, 'reparo', 'Troca de pastilhas + disco dianteiro', 2000, v_robo, now()-interval '39 days');
      v_prev := 2000;
      IF v_it2 IS NOT NULL THEN
        INSERT INTO insp_resposta (company_id, vistoria_id, item_id, estado, descricao, gasto_previsto, respondido_por, respondido_em)
        VALUES (v_bot, v_vist, v_it2, 'reparo', 'Revisão do ar-condicionado', 1500, v_robo, now()-interval '39 days');
        v_prev := 3500;
      END IF;
      UPDATE insp_vistoria SET previsao_total = v_prev WHERE id = v_vist;
    END IF;
  END IF;
  INSERT INTO veic_veiculo (company_id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, preco_minimo, precificado_em, ativo, observacao, created_by)
  VALUES (v_bot, 'DEMO0REVENDA0ONIX2', 'Chevrolet', 'Onix 1.0', 2022, 2023, 'Branco', 'flex', 42000, 'disponivel', 'compra_pj', current_date-25, 46000, 58000, NULL, now()-interval '5 days', true, 'Segundo Onix no pátio — comparação de preço.', v_robo)
  RETURNING id INTO v_onix2;
  INSERT INTO veic_veiculo (company_id, chassi, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, km_entrada, situacao, origem, data_entrada, valor_aquisicao, preco_venda, ativo, observacao, created_by)
  VALUES (v_bot, 'DEMO0REVENDA0ONIX3', 'Chevrolet', 'Onix 1.0', 2021, 2022, 'Prata', 'flex', 55000, 'entregue', 'compra_pj', current_date-68, 44000, 57000, true, 'Onix vendido — histórico de giro.', v_robo)
  RETURNING id INTO v_onix3;
  INSERT INTO veic_venda (company_id, veiculo_id, numero, cliente_nome, data_venda, valor_venda, valor_entrada, situacao, vendedor_nome, observacao, created_by)
  VALUES (v_bot, v_onix3, 'DEMO-V-ONIX3', 'Cliente Onix', current_date-40, 57000, 57000, 'entregue', 'Marcos Souza', 'Venda histórica (giro).', v_robo);

  -- R6-fiscal (RD-69): o perfil fiscal Presumido/SC da demo também nasce do seed único.
  PERFORM fn_gold_revenda_seed_fiscal_alliance(v_bot);

  RETURN jsonb_build_object('ok', true, 'onix', v_onix, 'vistoria', v_vist, 'previsao', v_prev,
    'onix_patio', v_onix2, 'onix_vendido', v_onix3);
END $function$;

-- Popula na Demo ao aplicar (idempotente).
SELECT public.fn_gold_revenda_seed_fiscal_alliance('b0700000-0000-4000-a000-000000000003');
