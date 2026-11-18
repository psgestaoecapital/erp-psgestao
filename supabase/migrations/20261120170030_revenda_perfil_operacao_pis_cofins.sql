-- #9787 · PERFIL fiscal = fonte da verdade: PIS/COFINS por OPERAÇÃO da revenda.
-- A emissão real das notas (principalmente ENTRADA: compra PF/PJ, troca) precisa do CST (e alíquota) de
-- PIS e COFINS, que hoje o perfil NÃO guarda por operação (a venda usava pis_pct/cofins_pct do nível do
-- perfil com CST fixo). Esta migration acrescenta os campos por operação e os costura nas RPCs obter/salvar,
-- para o contador preencher no perfil e o motor ler dali (sem hardcode). Nenhum valor é inventado aqui.
--
-- Aditivo: ADD COLUMN IF NOT EXISTS (nullable) + CREATE OR REPLACE das 2 RPCs (cópia exata + os 4 campos).
-- SECURITY DEFINER/grants inalterados. Sensível (perfil fiscal) → revisao-eng-chefe.
-- Reverter: ALTER TABLE ... DROP COLUMN pis_cst, cofins_cst, pis_aliquota, cofins_aliquota; (+ RPCs anteriores).

ALTER TABLE public.veic_perfil_fiscal_operacao
  ADD COLUMN IF NOT EXISTS pis_cst text,
  ADD COLUMN IF NOT EXISTS cofins_cst text,
  ADD COLUMN IF NOT EXISTS pis_aliquota numeric,
  ADD COLUMN IF NOT EXISTS cofins_aliquota numeric;

COMMENT ON COLUMN public.veic_perfil_fiscal_operacao.pis_cst IS '#9787 · CST do PIS desta operação (do perfil aprovado; usado na emissão).';
COMMENT ON COLUMN public.veic_perfil_fiscal_operacao.cofins_cst IS '#9787 · CST da COFINS desta operação (do perfil aprovado; usado na emissão).';

CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_salvar(p_company_id uuid, p_dados jsonb, p_operacoes jsonb DEFAULT NULL::jsonb, p_por text DEFAULT 'empresa'::text, p_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    regime = NULLIF(p_dados->>'regime',''), anexo_faixa = p_dados->>'anexo_faixa',
    usa_trib_diferenca_pis_cofins = (p_dados->>'usa_trib_diferenca_pis_cofins')::boolean,
    usa_trib_diferenca_irpj_csll = (p_dados->>'usa_trib_diferenca_irpj_csll')::boolean,
    icms_saida_regra = NULLIF(p_dados->>'icms_saida_regra',''), icms_saida_pct = NULLIF(p_dados->>'icms_saida_pct','')::numeric, icms_saida_base_legal = p_dados->>'icms_saida_base_legal',
    nfe_entrada_pf = (p_dados->>'nfe_entrada_pf')::boolean, dados_obrigatorios_entrada = p_dados->'dados_obrigatorios_entrada',
    veicprod_obrigatorio_usado = (p_dados->>'veicprod_obrigatorio_usado')::boolean, troca_valor_base = NULLIF(p_dados->>'troca_valor_base',''),
    consignacao_documentos = p_dados->>'consignacao_documentos', consignacao_comissao_tributacao = p_dados->>'consignacao_comissao_tributacao',
    garantia_provisao = (p_dados->>'garantia_provisao')::boolean, garantia_conta_id = NULLIF(p_dados->>'garantia_conta_id','')::uuid,
    renave_aplica = (p_dados->>'renave_aplica')::boolean, reforma_tratamento = p_dados->>'reforma_tratamento',
    comissao_base = NULLIF(p_dados->>'comissao_base',''), encargos_pct = NULLIF(p_dados->>'encargos_pct','')::numeric,
    coaf_responsavel = p_dados->>'coaf_responsavel', coaf_limite_especie = NULLIF(p_dados->>'coaf_limite_especie','')::numeric,
    -- R9b · alíquotas por categoria (chave ausente → mantém)
    pis_pct = CASE WHEN p_dados ? 'pis_pct' THEN NULLIF(p_dados->>'pis_pct','')::numeric ELSE pis_pct END,
    cofins_pct = CASE WHEN p_dados ? 'cofins_pct' THEN NULLIF(p_dados->>'cofins_pct','')::numeric ELSE cofins_pct END,
    irpj_pct = CASE WHEN p_dados ? 'irpj_pct' THEN NULLIF(p_dados->>'irpj_pct','')::numeric ELSE irpj_pct END,
    irpj_presuncao_pct = CASE WHEN p_dados ? 'irpj_presuncao_pct' THEN NULLIF(p_dados->>'irpj_presuncao_pct','')::numeric ELSE irpj_presuncao_pct END,
    csll_pct = CASE WHEN p_dados ? 'csll_pct' THEN NULLIF(p_dados->>'csll_pct','')::numeric ELSE csll_pct END,
    csll_presuncao_pct = CASE WHEN p_dados ? 'csll_presuncao_pct' THEN NULLIF(p_dados->>'csll_presuncao_pct','')::numeric ELSE csll_presuncao_pct END,
    icms_reducao_base_pct = CASE WHEN p_dados ? 'icms_reducao_base_pct' THEN NULLIF(p_dados->>'icms_reducao_base_pct','')::numeric ELSE icms_reducao_base_pct END,
    -- #5622 · NCM padrão (só dígitos; chave ausente → mantém; vazio → NULL)
    ncm_padrao = CASE WHEN p_dados ? 'ncm_padrao' THEN NULLIF(regexp_replace(p_dados->>'ncm_padrao','[^0-9]','','g'),'') ELSE ncm_padrao END,
    justificativas = COALESCE(p_dados->'justificativas', justificativas), observacao = p_dados->>'observacao',
    updated_at = now()
  WHERE id = v_id;
  IF p_operacoes IS NOT NULL AND jsonb_typeof(p_operacoes) = 'array' THEN
    DELETE FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_id;
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_operacoes) LOOP
      IF COALESCE(v_op->>'operacao','') <> '' THEN
        INSERT INTO veic_perfil_fiscal_operacao (perfil_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, emite_nota_entrada, observacao,
          cbenef, cst_icms, reducao_base_icms_pct, reducao_base_icms_base_legal, ibs_cbs_cst, ibs_cbs_cclasstrib, inf_complementar_texto, natureza_operacao,
          pis_cst, cofins_cst, pis_aliquota, cofins_aliquota)
        VALUES (v_id, p_company_id, v_op->>'operacao', v_op->>'cfop_dentro_uf', v_op->>'cfop_fora_uf', v_op->>'cst_ou_csosn',
                COALESCE((v_op->>'emite_nota_entrada')::boolean,false), v_op->>'observacao',
                v_op->>'cbenef', v_op->>'cst_icms', NULLIF(v_op->>'reducao_base_icms_pct','')::numeric, v_op->>'reducao_base_icms_base_legal',
                v_op->>'ibs_cbs_cst', v_op->>'ibs_cbs_cclasstrib', v_op->>'inf_complementar_texto', v_op->>'natureza_operacao',
                NULLIF(v_op->>'pis_cst',''), NULLIF(v_op->>'cofins_cst',''), NULLIF(v_op->>'pis_aliquota','')::numeric, NULLIF(v_op->>'cofins_aliquota','')::numeric)
        ON CONFLICT (perfil_id, operacao) DO UPDATE SET cfop_dentro_uf=EXCLUDED.cfop_dentro_uf, cfop_fora_uf=EXCLUDED.cfop_fora_uf,
          cst_ou_csosn=EXCLUDED.cst_ou_csosn, emite_nota_entrada=EXCLUDED.emite_nota_entrada, observacao=EXCLUDED.observacao,
          cbenef=EXCLUDED.cbenef, cst_icms=EXCLUDED.cst_icms, reducao_base_icms_pct=EXCLUDED.reducao_base_icms_pct,
          reducao_base_icms_base_legal=EXCLUDED.reducao_base_icms_base_legal, ibs_cbs_cst=EXCLUDED.ibs_cbs_cst,
          ibs_cbs_cclasstrib=EXCLUDED.ibs_cbs_cclasstrib, inf_complementar_texto=EXCLUDED.inf_complementar_texto,
          natureza_operacao=EXCLUDED.natureza_operacao,
          pis_cst=EXCLUDED.pis_cst, cofins_cst=EXCLUDED.cofins_cst, pis_aliquota=EXCLUDED.pis_aliquota, cofins_aliquota=EXCLUDED.cofins_aliquota;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true, 'perfil_id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_obter(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_edit record; v_apr record; v_ops jsonb; v_ops_apr jsonb; v_vig jsonb; v_hist jsonb; v_conv jsonb; v_apr_j jsonb;
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
             'natureza_operacao',natureza_operacao,
             'pis_cst',pis_cst,'cofins_cst',cofins_cst,'pis_aliquota',pis_aliquota,'cofins_aliquota',cofins_aliquota) ORDER BY operacao)
      INTO v_ops FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_edit.id;
  ELSE
    -- #5659 · sem rascunho: devolve a última versão aprovada para a tela mostrar preenchida e bloqueada
    SELECT * INTO v_apr FROM veic_perfil_fiscal
     WHERE company_id = p_company_id AND status = 'aprovado' ORDER BY versao DESC LIMIT 1;
    IF FOUND THEN
      SELECT jsonb_agg(jsonb_build_object('operacao',operacao,'cfop_dentro_uf',cfop_dentro_uf,'cfop_fora_uf',cfop_fora_uf,
               'cst_ou_csosn',cst_ou_csosn,'emite_nota_entrada',emite_nota_entrada,'observacao',observacao,
               'cbenef',cbenef,'cst_icms',cst_icms,'reducao_base_icms_pct',reducao_base_icms_pct,
               'reducao_base_icms_base_legal',reducao_base_icms_base_legal,'ibs_cbs_cst',ibs_cbs_cst,
               'ibs_cbs_cclasstrib',ibs_cbs_cclasstrib,'inf_complementar_texto',inf_complementar_texto,
               'natureza_operacao',natureza_operacao,
               'pis_cst',pis_cst,'cofins_cst',cofins_cst,'pis_aliquota',pis_aliquota,'cofins_aliquota',cofins_aliquota) ORDER BY operacao)
        INTO v_ops_apr FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_apr.id;
      v_apr_j := (to_jsonb(v_apr) - 'company_id' - 'criado_por' - 'aprovado_por' - 'criado_em' - 'updated_at')
        || jsonb_build_object('aprovado_por_nome', CASE WHEN v_apr.aprovado_por IS NOT NULL THEN fn_usuario_nome(v_apr.aprovado_por) END,
                              'operacoes', COALESCE(v_ops_apr, '[]'::jsonb));
    END IF;
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
      'pis_pct', v_edit.pis_pct, 'cofins_pct', v_edit.cofins_pct,
      'irpj_pct', v_edit.irpj_pct, 'irpj_presuncao_pct', v_edit.irpj_presuncao_pct,
      'csll_pct', v_edit.csll_pct, 'csll_presuncao_pct', v_edit.csll_presuncao_pct,
      'icms_reducao_base_pct', v_edit.icms_reducao_base_pct,
      'justificativas', v_edit.justificativas, 'observacao', v_edit.observacao,
      'operacoes', COALESCE(v_ops, '[]'::jsonb)) END,
    'aprovado', v_apr_j,
    'historico', COALESCE(v_hist, '[]'::jsonb),
    'convite', v_conv);
END $function$;
