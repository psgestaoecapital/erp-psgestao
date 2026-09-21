-- Revenda · Perfil Fiscal (PF-c · banco da tela) — obter / salvar / enviar / aprovar
--
-- A Tela 11 (dono e equipe PS) lê e edita o perfil por estas RPCs. Guarda de empresa, sem anon.
-- O modelo por UF×regime é ponto de partida; nada é regra fixa (RD-51/65). Idempotente/aditivo.

-- Estado + rascunho editável + histórico para a tela.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_obter(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_edit record; v_ops jsonb; v_vig jsonb; v_hist jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_vig := fn_veic_perfil_fiscal_vigente(p_company_id);
  -- rascunho/aguardando é o editável; se não há, a tela começa do zero (ou de um modelo)
  SELECT * INTO v_edit FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status IN ('rascunho','aguardando_aprovacao')
   ORDER BY versao DESC LIMIT 1;
  IF FOUND THEN
    SELECT jsonb_agg(jsonb_build_object('operacao',operacao,'cfop_dentro_uf',cfop_dentro_uf,'cfop_fora_uf',cfop_fora_uf,
             'cst_ou_csosn',cst_ou_csosn,'emite_nota_entrada',emite_nota_entrada,'observacao',observacao) ORDER BY operacao)
      INTO v_ops FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_edit.id;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',id,'versao',versao,'status',status,'vigente_desde',vigente_desde,
           'aprovado_em',aprovado_em,'preenchido_por',preenchido_por) ORDER BY versao DESC)
    INTO v_hist FROM veic_perfil_fiscal WHERE company_id = p_company_id;

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
      'justificativas', v_edit.justificativas, 'observacao', v_edit.observacao,
      'operacoes', COALESCE(v_ops, '[]'::jsonb)) END,
    'historico', COALESCE(v_hist, '[]'::jsonb));
END $function$;

-- Salvar rascunho (cria a versão editável se não existir). p_dados = campos; p_operacoes = array de operações.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_salvar(p_company_id uuid, p_dados jsonb, p_operacoes jsonb DEFAULT NULL, p_por text DEFAULT 'empresa', p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_op jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT id INTO v_id FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status IN ('rascunho','aguardando_aprovacao') ORDER BY versao DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO veic_perfil_fiscal (company_id, versao, status, preenchido_por, criado_por)
    VALUES (p_company_id, COALESCE((SELECT max(versao) FROM veic_perfil_fiscal WHERE company_id=p_company_id),0)+1,
            'rascunho', p_por, p_user)
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
    justificativas = COALESCE(p_dados->'justificativas', justificativas), observacao = p_dados->>'observacao',
    updated_at = now()
  WHERE id = v_id;

  IF p_operacoes IS NOT NULL AND jsonb_typeof(p_operacoes) = 'array' THEN
    DELETE FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_id;
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_operacoes) LOOP
      IF COALESCE(v_op->>'operacao','') <> '' THEN
        INSERT INTO veic_perfil_fiscal_operacao (perfil_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, emite_nota_entrada, observacao)
        VALUES (v_id, p_company_id, v_op->>'operacao', v_op->>'cfop_dentro_uf', v_op->>'cfop_fora_uf', v_op->>'cst_ou_csosn',
                COALESCE((v_op->>'emite_nota_entrada')::boolean,false), v_op->>'observacao')
        ON CONFLICT (perfil_id, operacao) DO UPDATE SET cfop_dentro_uf=EXCLUDED.cfop_dentro_uf, cfop_fora_uf=EXCLUDED.cfop_fora_uf,
          cst_ou_csosn=EXCLUDED.cst_ou_csosn, emite_nota_entrada=EXCLUDED.emite_nota_entrada, observacao=EXCLUDED.observacao;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true, 'perfil_id', v_id);
END $function$;

-- Enviar para aprovação (rascunho → aguardando_aprovacao).
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_enviar(p_perfil_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_status text;
BEGIN
  SELECT company_id, status INTO v_comp, v_status FROM veic_perfil_fiscal WHERE id = p_perfil_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'perfil_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_status <> 'rascunho' THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_rascunho'); END IF;
  UPDATE veic_perfil_fiscal SET status = 'aguardando_aprovacao', updated_at = now() WHERE id = p_perfil_id;
  RETURN jsonb_build_object('ok', true, 'status', 'aguardando_aprovacao');
END $function$;

-- Aprovar (o dono/PS). Supersede o aprovado anterior; passa a vigente na data informada (ou hoje).
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_aprovar(p_perfil_id uuid, p_user uuid DEFAULT NULL, p_vigente_desde date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_status text; v_vig date;
BEGIN
  SELECT company_id, status INTO v_comp, v_status FROM veic_perfil_fiscal WHERE id = p_perfil_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'perfil_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_status NOT IN ('rascunho','aguardando_aprovacao') THEN RETURN jsonb_build_object('ok', false, 'erro', 'estado_invalido', 'status', v_status); END IF;
  v_vig := COALESCE(p_vigente_desde, current_date);
  -- supersede aprovados anteriores que passam a valer até esta data (mantém histórico)
  UPDATE veic_perfil_fiscal SET status = 'substituido', updated_at = now()
   WHERE company_id = v_comp AND status = 'aprovado' AND id <> p_perfil_id AND vigente_desde <= v_vig;
  UPDATE veic_perfil_fiscal SET status = 'aprovado', aprovado_por = p_user, aprovado_em = now(), vigente_desde = v_vig, updated_at = now()
   WHERE id = p_perfil_id;
  RETURN jsonb_build_object('ok', true, 'status', 'aprovado', 'vigente_desde', v_vig);
END $function$;
