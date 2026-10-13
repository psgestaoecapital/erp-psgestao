-- R9b · Tributação sobre a DIFERENÇA por veículo (Revenda / Onda 9). Genérico: nenhuma alíquota fixa no
-- código — tudo vem do PERFIL FISCAL VIGENTE (aprovado). O perfil ganha as alíquotas por categoria
-- (PIS/COFINS/IRPJ/CSLL + presunção) e a redução de base do ICMS. fn_veic_tributos_diferenca(veiculo)
-- calcula os encargos R$ reais; a conta do carro passa a usar esse encargo quando há perfil aprovado com
-- alíquotas (substitui o % fixo), senão mantém o % da config e AVISA (RD-51/RD-65).

-- ── 1) alíquotas configuráveis no perfil (definidas com o contador) ──────────
ALTER TABLE public.veic_perfil_fiscal
  ADD COLUMN IF NOT EXISTS pis_pct numeric,
  ADD COLUMN IF NOT EXISTS cofins_pct numeric,
  ADD COLUMN IF NOT EXISTS irpj_pct numeric,
  ADD COLUMN IF NOT EXISTS irpj_presuncao_pct numeric,
  ADD COLUMN IF NOT EXISTS csll_pct numeric,
  ADD COLUMN IF NOT EXISTS csll_presuncao_pct numeric,
  ADD COLUMN IF NOT EXISTS icms_reducao_base_pct numeric;

-- ── 2) fn de tributação sobre a diferença ───────────────────────────────────
-- base da diferença = preço de venda − custo de aquisição. Para cada tributo, a base é a DIFERENÇA quando
-- o perfil marca "tributa pela diferença", senão o preço cheio. IRPJ/CSLL aplicam a presunção do perfil.
-- ICMS usa a alíquota de saída com a redução de base do perfil. Sem alíquota → aquele tributo é 0 (não inventa).
CREATE OR REPLACE FUNCTION public.fn_veic_tributos_diferenca(p_veiculo_id uuid, p_preco numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; vp record; v_preco numeric; v_aquis numeric; v_dif numeric;
  v_base_pc numeric; v_base_ic numeric;
  v_pis numeric; v_cofins numeric; v_irpj numeric; v_csll numeric; v_icms numeric; v_total numeric;
  v_pis_pct numeric; v_cofins_pct numeric; v_irpj_pct numeric; v_irpj_pres numeric; v_csll_pct numeric; v_csll_pres numeric;
  v_icms_pct numeric; v_icms_red numeric; v_usa_pc boolean; v_usa_ic boolean; v_tem_rates boolean;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT COALESCE(p_preco, preco_venda), valor_aquisicao INTO v_preco, v_aquis FROM veic_veiculo WHERE id = p_veiculo_id;

  -- perfil VIGENTE (aprovado) direto da tabela — precisamos das alíquotas, que o resumo do vigente não traz
  SELECT * INTO vp FROM veic_perfil_fiscal
   WHERE company_id = v_comp AND status = 'aprovado' AND vigente_desde <= current_date
   ORDER BY vigente_desde DESC, versao DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'aprovado', false, 'tem_rates', false,
      'aviso', 'Sem perfil fiscal aprovado — os encargos usam o % da configuração.'); END IF;

  v_pis_pct := vp.pis_pct; v_cofins_pct := vp.cofins_pct;
  v_irpj_pct := vp.irpj_pct; v_irpj_pres := vp.irpj_presuncao_pct;
  v_csll_pct := vp.csll_pct; v_csll_pres := vp.csll_presuncao_pct;
  v_icms_pct := vp.icms_saida_pct; v_icms_red := COALESCE(vp.icms_reducao_base_pct, 0);
  v_usa_pc := COALESCE(vp.usa_trib_diferenca_pis_cofins, false);
  v_usa_ic := COALESCE(vp.usa_trib_diferenca_irpj_csll, false);
  v_tem_rates := (COALESCE(v_pis_pct,0)+COALESCE(v_cofins_pct,0)+COALESCE(v_irpj_pct,0)+COALESCE(v_csll_pct,0)+COALESCE(v_icms_pct,0)) > 0;

  IF v_preco IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'aprovado', true, 'tem_rates', v_tem_rates,
      'aviso', 'Veículo sem preço de venda — não dá para calcular os tributos.'); END IF;

  v_dif := GREATEST(COALESCE(v_preco,0) - COALESCE(v_aquis,0), 0);
  v_base_pc := CASE WHEN v_usa_pc THEN v_dif ELSE v_preco END;   -- base PIS/COFINS
  v_base_ic := CASE WHEN v_usa_ic THEN v_dif ELSE v_preco END;   -- base IRPJ/CSLL (antes da presunção)

  v_pis    := round(v_base_pc * COALESCE(v_pis_pct,0)/100.0, 2);
  v_cofins := round(v_base_pc * COALESCE(v_cofins_pct,0)/100.0, 2);
  v_irpj   := round(v_base_ic * COALESCE(v_irpj_pres,100)/100.0 * COALESCE(v_irpj_pct,0)/100.0, 2);
  v_csll   := round(v_base_ic * COALESCE(v_csll_pres,100)/100.0 * COALESCE(v_csll_pct,0)/100.0, 2);
  v_icms   := round(v_preco * (1 - v_icms_red/100.0) * COALESCE(v_icms_pct,0)/100.0, 2);
  v_total  := v_pis + v_cofins + v_irpj + v_csll + v_icms;

  RETURN jsonb_build_object('ok', true, 'aprovado', true, 'tem_rates', v_tem_rates,
    'preco', v_preco, 'custo_aquisicao', v_aquis, 'diferenca', v_dif,
    'detalhe', jsonb_build_object('pis', v_pis, 'cofins', v_cofins, 'irpj', v_irpj, 'csll', v_csll, 'icms', v_icms),
    'encargos_total', v_total,
    'encargos_pct_efetivo', CASE WHEN v_preco > 0 THEN round(v_total / v_preco * 100, 4) END);
END $function$;

-- ── 3) fn_veic_perfil_fiscal_salvar: aceita as novas alíquotas ───────────────
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_salvar(p_company_id uuid, p_dados jsonb, p_operacoes jsonb DEFAULT NULL::jsonb, p_por text DEFAULT 'empresa'::text, p_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_op jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  PERFORM set_config('app.perfil_fiscal_transicao', 'on', true);
  SELECT id INTO v_id FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status IN ('rascunho','aguardando_aprovacao') ORDER BY versao DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO veic_perfil_fiscal (company_id, versao, status, preenchido_por, criado_por)
    VALUES (p_company_id, COALESCE((SELECT max(versao) FROM veic_perfil_fiscal WHERE company_id=p_company_id),0)+1, 'rascunho', p_por, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  UPDATE veic_perfil_fiscal SET
    status = 'rascunho', preenchido_por = COALESCE(p_por, preenchido_por),
    regime = p_dados->>'regime', anexo_faixa = p_dados->>'anexo_faixa',
    usa_trib_diferenca_pis_cofins = (p_dados->>'usa_trib_diferenca_pis_cofins')::boolean,
    usa_trib_diferenca_irpj_csll = (p_dados->>'usa_trib_diferenca_irpj_csll')::boolean,
    icms_saida_regra = p_dados->>'icms_saida_regra', icms_saida_pct = NULLIF(p_dados->>'icms_saida_pct','')::numeric, icms_saida_base_legal = p_dados->>'icms_saida_base_legal',
    nfe_entrada_pf = (p_dados->>'nfe_entrada_pf')::boolean, dados_obrigatorios_entrada = p_dados->'dados_obrigatorios_entrada',
    veicprod_obrigatorio_usado = (p_dados->>'veicprod_obrigatorio_usado')::boolean, troca_valor_base = p_dados->>'troca_valor_base',
    consignacao_documentos = p_dados->>'consignacao_documentos', consignacao_comissao_tributacao = p_dados->>'consignacao_comissao_tributacao',
    garantia_provisao = (p_dados->>'garantia_provisao')::boolean, garantia_conta_id = NULLIF(p_dados->>'garantia_conta_id','')::uuid,
    renave_aplica = (p_dados->>'renave_aplica')::boolean, reforma_tratamento = p_dados->>'reforma_tratamento',
    comissao_base = p_dados->>'comissao_base', encargos_pct = NULLIF(p_dados->>'encargos_pct','')::numeric,
    coaf_responsavel = p_dados->>'coaf_responsavel', coaf_limite_especie = NULLIF(p_dados->>'coaf_limite_especie','')::numeric,
    -- R9b · alíquotas por categoria (chave ausente → mantém)
    pis_pct = CASE WHEN p_dados ? 'pis_pct' THEN NULLIF(p_dados->>'pis_pct','')::numeric ELSE pis_pct END,
    cofins_pct = CASE WHEN p_dados ? 'cofins_pct' THEN NULLIF(p_dados->>'cofins_pct','')::numeric ELSE cofins_pct END,
    irpj_pct = CASE WHEN p_dados ? 'irpj_pct' THEN NULLIF(p_dados->>'irpj_pct','')::numeric ELSE irpj_pct END,
    irpj_presuncao_pct = CASE WHEN p_dados ? 'irpj_presuncao_pct' THEN NULLIF(p_dados->>'irpj_presuncao_pct','')::numeric ELSE irpj_presuncao_pct END,
    csll_pct = CASE WHEN p_dados ? 'csll_pct' THEN NULLIF(p_dados->>'csll_pct','')::numeric ELSE csll_pct END,
    csll_presuncao_pct = CASE WHEN p_dados ? 'csll_presuncao_pct' THEN NULLIF(p_dados->>'csll_presuncao_pct','')::numeric ELSE csll_presuncao_pct END,
    icms_reducao_base_pct = CASE WHEN p_dados ? 'icms_reducao_base_pct' THEN NULLIF(p_dados->>'icms_reducao_base_pct','')::numeric ELSE icms_reducao_base_pct END,
    justificativas = COALESCE(p_dados->'justificativas', justificativas), observacao = p_dados->>'observacao',
    updated_at = now()
  WHERE id = v_id;
  IF p_operacoes IS NOT NULL AND jsonb_typeof(p_operacoes) = 'array' THEN
    DELETE FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_id;
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_operacoes) LOOP
      IF COALESCE(v_op->>'operacao','') <> '' THEN
        INSERT INTO veic_perfil_fiscal_operacao (perfil_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, emite_nota_entrada, observacao,
          cbenef, cst_icms, reducao_base_icms_pct, reducao_base_icms_base_legal, ibs_cbs_cst, ibs_cbs_cclasstrib, inf_complementar_texto, natureza_operacao)
        VALUES (v_id, p_company_id, v_op->>'operacao', v_op->>'cfop_dentro_uf', v_op->>'cfop_fora_uf', v_op->>'cst_ou_csosn',
                COALESCE((v_op->>'emite_nota_entrada')::boolean,false), v_op->>'observacao',
                v_op->>'cbenef', v_op->>'cst_icms', NULLIF(v_op->>'reducao_base_icms_pct','')::numeric, v_op->>'reducao_base_icms_base_legal',
                v_op->>'ibs_cbs_cst', v_op->>'ibs_cbs_cclasstrib', v_op->>'inf_complementar_texto', v_op->>'natureza_operacao')
        ON CONFLICT (perfil_id, operacao) DO UPDATE SET cfop_dentro_uf=EXCLUDED.cfop_dentro_uf, cfop_fora_uf=EXCLUDED.cfop_fora_uf,
          cst_ou_csosn=EXCLUDED.cst_ou_csosn, emite_nota_entrada=EXCLUDED.emite_nota_entrada, observacao=EXCLUDED.observacao,
          cbenef=EXCLUDED.cbenef, cst_icms=EXCLUDED.cst_icms, reducao_base_icms_pct=EXCLUDED.reducao_base_icms_pct,
          reducao_base_icms_base_legal=EXCLUDED.reducao_base_icms_base_legal, ibs_cbs_cst=EXCLUDED.ibs_cbs_cst,
          ibs_cbs_cclasstrib=EXCLUDED.ibs_cbs_cclasstrib, inf_complementar_texto=EXCLUDED.inf_complementar_texto,
          natureza_operacao=EXCLUDED.natureza_operacao;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true, 'perfil_id', v_id);
END $function$;

-- ── 4) conta do carro passa a usar o encargo do perfil quando aprovado c/ alíquotas (senão % config + aviso) ──
CREATE OR REPLACE FUNCTION public.fn_veic_conta_do_carro(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v record; v_pm jsonb; v_carrego jsonb; v_trib jsonb;
  v_aquisicao numeric; v_custos numeric; v_previsao numeric; v_custo_precif numeric;
  v_enc_soma numeric; v_enc_frac numeric; v_preco_min numeric; v_piso numeric;
  v_carrego_total numeric; v_custo_real numeric; v_anunciado numeric;
  v_lucro numeric; v_base numeric; v_dias int; v_roi numeric; v_sangria_dia numeric; v_vira date;
  v_enc_fonte text := 'config_pct';
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, marca, modelo, placa, preco_venda INTO v FROM veic_veiculo WHERE id = p_veiculo_id;

  v_pm      := fn_veic_preco_minimo(p_veiculo_id);
  v_carrego := fn_veic_carrego(p_veiculo_id);

  v_aquisicao    := NULLIF(v_pm->'custo'->>'aquisicao','')::numeric;
  v_custos       := NULLIF(v_pm->'custo'->>'custos_lancados','')::numeric;
  v_previsao     := NULLIF(v_pm->'custo'->>'previsao_gastos','')::numeric;
  v_custo_precif := COALESCE(NULLIF(v_pm->'custo'->>'numerador','')::numeric, NULLIF(v_pm->'custo'->>'custo_total','')::numeric);
  v_enc_soma     := NULLIF(v_pm->'encargos_pct'->>'soma','')::numeric;
  v_preco_min    := NULLIF(v_pm->>'preco_minimo','')::numeric;
  v_piso         := NULLIF(v_pm->>'piso_sem_margem','')::numeric;
  v_carrego_total := NULLIF(v_carrego->>'total','')::numeric;
  v_sangria_dia  := NULLIF(v_carrego->>'sangria_dia','')::numeric;
  v_dias         := NULLIF(v_carrego->>'dias_parado','')::int;
  v_base         := NULLIF(v_carrego->>'capital_investido','')::numeric;
  v_anunciado    := v.preco_venda;

  -- R9b: encargo REAL do perfil aprovado (tributação sobre a diferença) substitui o % fixo quando disponível
  v_trib := fn_veic_tributos_diferenca(p_veiculo_id, v_anunciado);
  IF COALESCE((v_trib->>'aprovado')::boolean, false) AND COALESCE((v_trib->>'tem_rates')::boolean, false)
     AND (v_trib->>'encargos_pct_efetivo') IS NOT NULL THEN
    v_enc_soma := NULLIF(v_trib->>'encargos_pct_efetivo','')::numeric;
    v_enc_fonte := 'perfil_aprovado';
  END IF;

  v_enc_frac  := COALESCE(v_enc_soma,0)/100.0;
  v_custo_real := COALESCE(v_custo_precif,0) + COALESCE(v_carrego_total,0);
  v_lucro := CASE WHEN v_anunciado IS NULL THEN NULL ELSE round(v_anunciado * (1 - v_enc_frac) - v_custo_real, 2) END;
  v_roi := CASE WHEN v_lucro IS NOT NULL AND COALESCE(v_base,0) > 0 AND COALESCE(v_dias,0) > 0
                THEN round(v_lucro / v_base * 365.0 / v_dias * 100, 2) ELSE NULL END;
  v_vira := CASE WHEN v_lucro IS NOT NULL AND v_lucro > 0 AND COALESCE(v_sangria_dia,0) > 0
                 THEN current_date + floor(v_lucro / v_sangria_dia)::int ELSE NULL END;

  RETURN jsonb_build_object(
    'ok', true,
    'veiculo', jsonb_build_object('id', v.id, 'marca', v.marca, 'modelo', v.modelo, 'placa', v.placa),
    'comprei', v_aquisicao, 'custos_lancados', v_custos, 'previsao_vistoria', v_previsao,
    'comissao_reais', NULLIF(v_pm->'custo'->>'comissao_reais','')::numeric,
    'sobrepreco_troca', jsonb_build_object('valor', NULL, 'status', 'nao_rastreado'),
    'carrego', v_carrego, 'custo_real_total', round(v_custo_real, 2),
    'piso_sem_margem', v_piso, 'preco_minimo', v_preco_min, 'anunciado', v_anunciado,
    'lucro_real_projetado', v_lucro, 'roi_anualizado_pct', v_roi, 'capital_investido', v_base,
    'dias_parado', v_dias, 'sangria_dia', v_sangria_dia, 'data_vira_prejuizo', v_vira,
    'comissao', v_pm->'comissao', 'encargos_pct', v_enc_soma, 'encargos_fonte', v_enc_fonte,
    'tributos_diferenca', v_trib
  );
END $function$;

-- ── 5) obter passa a devolver as alíquotas no editavel (superset do R9a: histórico+convite mantidos) ──
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_obter(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_edit record; v_ops jsonb; v_vig jsonb; v_hist jsonb; v_conv jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_vig := fn_veic_perfil_fiscal_vigente(p_company_id);
  SELECT * INTO v_edit FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status IN ('rascunho','aguardando_aprovacao') ORDER BY versao DESC LIMIT 1;
  IF FOUND THEN
    SELECT jsonb_agg(jsonb_build_object('operacao',operacao,'cfop_dentro_uf',cfop_dentro_uf,'cfop_fora_uf',cfop_fora_uf,
             'cst_ou_csosn',cst_ou_csosn,'emite_nota_entrada',emite_nota_entrada,'observacao',observacao,
             'cbenef',cbenef,'cst_icms',cst_icms,'reducao_base_icms_pct',reducao_base_icms_pct,
             'reducao_base_icms_base_legal',reducao_base_icms_base_legal,'ibs_cbs_cst',ibs_cbs_cst,
             'ibs_cbs_cclasstrib',ibs_cbs_cclasstrib,'inf_complementar_texto',inf_complementar_texto,
             'natureza_operacao',natureza_operacao) ORDER BY operacao)
      INTO v_ops FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_edit.id;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',id,'versao',versao,'status',status,'vigente_desde',vigente_desde,
           'aprovado_em',aprovado_em,'aprovado_por_nome', CASE WHEN aprovado_por IS NOT NULL THEN fn_usuario_nome(aprovado_por) END,
           'preenchido_por',preenchido_por,'observacao',observacao) ORDER BY versao DESC)
    INTO v_hist FROM veic_perfil_fiscal WHERE company_id = p_company_id;
  SELECT to_jsonb(t) INTO v_conv FROM (
    SELECT email_contador AS email, status, criado_em, expira_em, usado_em,
           (status = 'pendente' AND expira_em IS NOT NULL AND expira_em < now()) AS expirado
    FROM veic_perfil_convite WHERE company_id = p_company_id ORDER BY criado_em DESC LIMIT 1) t;

  RETURN jsonb_build_object('ok', true,
    'vigente', v_vig,
    'editavel', CASE WHEN v_edit.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_edit.id, 'versao', v_edit.versao, 'status', v_edit.status, 'vigente_desde', v_edit.vigente_desde,
      'preenchido_por', v_edit.preenchido_por,
      'regime', v_edit.regime, 'anexo_faixa', v_edit.anexo_faixa,
      'usa_trib_diferenca_pis_cofins', v_edit.usa_trib_diferenca_pis_cofins, 'usa_trib_diferenca_irpj_csll', v_edit.usa_trib_diferenca_irpj_csll,
      'icms_saida_regra', v_edit.icms_saida_regra, 'icms_saida_pct', v_edit.icms_saida_pct, 'icms_saida_base_legal', v_edit.icms_saida_base_legal,
      'nfe_entrada_pf', v_edit.nfe_entrada_pf, 'dados_obrigatorios_entrada', v_edit.dados_obrigatorios_entrada,
      'veicprod_obrigatorio_usado', v_edit.veicprod_obrigatorio_usado, 'troca_valor_base', v_edit.troca_valor_base,
      'consignacao_documentos', v_edit.consignacao_documentos, 'consignacao_comissao_tributacao', v_edit.consignacao_comissao_tributacao,
      'garantia_provisao', v_edit.garantia_provisao, 'garantia_conta_id', v_edit.garantia_conta_id,
      'renave_aplica', v_edit.renave_aplica, 'reforma_tratamento', v_edit.reforma_tratamento,
      'comissao_base', v_edit.comissao_base, 'encargos_pct', v_edit.encargos_pct,
      'coaf_responsavel', v_edit.coaf_responsavel, 'coaf_limite_especie', v_edit.coaf_limite_especie,
      -- R9b · alíquotas por categoria
      'pis_pct', v_edit.pis_pct, 'cofins_pct', v_edit.cofins_pct,
      'irpj_pct', v_edit.irpj_pct, 'irpj_presuncao_pct', v_edit.irpj_presuncao_pct,
      'csll_pct', v_edit.csll_pct, 'csll_presuncao_pct', v_edit.csll_presuncao_pct,
      'icms_reducao_base_pct', v_edit.icms_reducao_base_pct,
      'justificativas', v_edit.justificativas, 'observacao', v_edit.observacao,
      'operacoes', COALESCE(v_ops, '[]'::jsonb)) END,
    'historico', COALESCE(v_hist, '[]'::jsonb),
    'convite', v_conv);
END $function$;

-- ── grants (CEO: SECURITY DEFINER sem anon) ─────────────────────────────────
REVOKE ALL ON FUNCTION public.fn_veic_tributos_diferenca(uuid,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_salvar(uuid,jsonb,jsonb,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_conta_do_carro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_tributos_diferenca(uuid,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_salvar(uuid,jsonb,jsonb,text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_conta_do_carro(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid) TO authenticated, service_role;
