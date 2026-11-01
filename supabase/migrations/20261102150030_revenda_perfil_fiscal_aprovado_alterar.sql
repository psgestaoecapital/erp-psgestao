-- Chamado #5659 (Alliance, vale p/ todas as revendas): perfil fiscal aprovado abria em branco.
-- (1) fn_veic_perfil_fiscal_obter passa a devolver 'aprovado' (mesmo formato do 'editavel' + aprovado_por_nome + operacoes)
--     quando NÃO há rascunho; (2) nova fn_veic_perfil_fiscal_nova_versao ("Alterar") copia o aprovado para um rascunho.
-- Não muda a regra de aprovação nem o gate de emissão: a versão aprovada segue vigente até a nova ser aprovada.
-- ADITIVA para leitura; obter só ganha uma chave nova ('aprovado'). Plano de volta: reaplicar a definição anterior de obter e DROP da função nova.

CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_obter(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_edit record; v_apr record; v_ops jsonb; v_ops_apr jsonb; v_vig jsonb; v_hist jsonb; v_conv jsonb;
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
               'natureza_operacao',natureza_operacao) ORDER BY operacao)
        INTO v_ops_apr FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_apr.id;
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
    'aprovado', CASE WHEN v_apr.id IS NULL THEN NULL ELSE
      (to_jsonb(v_apr) - 'company_id' - 'criado_por' - 'aprovado_por' - 'criado_em' - 'updated_at')
      || jsonb_build_object('aprovado_por_nome', CASE WHEN v_apr.aprovado_por IS NOT NULL THEN fn_usuario_nome(v_apr.aprovado_por) END,
                            'operacoes', COALESCE(v_ops_apr, '[]'::jsonb)) END,
    'historico', COALESCE(v_hist, '[]'::jsonb),
    'convite', v_conv);
END $function$;

-- "Alterar": cria a próxima versão em rascunho copiando a aprovada (campos + operações). Idempotente: se já há rascunho, devolve o dele.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_nova_versao(p_company_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_apr veic_perfil_fiscal%ROWTYPE;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id INTO v_id FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status IN ('rascunho','aguardando_aprovacao') ORDER BY versao DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'perfil_id', v_id, 'ja_existia', true); END IF;
  SELECT * INTO v_apr FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status = 'aprovado' ORDER BY versao DESC LIMIT 1;
  IF v_apr.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_perfil_aprovado'); END IF;
  PERFORM set_config('app.perfil_fiscal_transicao', 'on', true);
  INSERT INTO veic_perfil_fiscal (company_id, versao, status, preenchido_por, criado_por,
      regime, anexo_faixa, usa_trib_diferenca_pis_cofins, usa_trib_diferenca_irpj_csll, icms_saida_regra, icms_saida_pct, icms_saida_base_legal,
      nfe_entrada_pf, dados_obrigatorios_entrada, veicprod_obrigatorio_usado, troca_valor_base, consignacao_documentos, consignacao_comissao_tributacao,
      garantia_provisao, garantia_conta_id, renave_aplica, reforma_tratamento, comissao_base, encargos_pct, coaf_responsavel, coaf_limite_especie,
      justificativas, observacao, ncm_padrao, pis_pct, cofins_pct, irpj_pct, irpj_presuncao_pct, csll_pct, csll_presuncao_pct, icms_reducao_base_pct)
  VALUES (p_company_id, COALESCE((SELECT max(versao) FROM veic_perfil_fiscal WHERE company_id = p_company_id),0)+1, 'rascunho', 'empresa', COALESCE(p_user, auth.uid()),
      v_apr.regime, v_apr.anexo_faixa, v_apr.usa_trib_diferenca_pis_cofins, v_apr.usa_trib_diferenca_irpj_csll, v_apr.icms_saida_regra, v_apr.icms_saida_pct, v_apr.icms_saida_base_legal,
      v_apr.nfe_entrada_pf, v_apr.dados_obrigatorios_entrada, v_apr.veicprod_obrigatorio_usado, v_apr.troca_valor_base, v_apr.consignacao_documentos, v_apr.consignacao_comissao_tributacao,
      v_apr.garantia_provisao, v_apr.garantia_conta_id, v_apr.renave_aplica, v_apr.reforma_tratamento, v_apr.comissao_base, v_apr.encargos_pct, v_apr.coaf_responsavel, v_apr.coaf_limite_especie,
      v_apr.justificativas, v_apr.observacao, v_apr.ncm_padrao, v_apr.pis_pct, v_apr.cofins_pct, v_apr.irpj_pct, v_apr.irpj_presuncao_pct, v_apr.csll_pct, v_apr.csll_presuncao_pct, v_apr.icms_reducao_base_pct)
  RETURNING id INTO v_id;
  INSERT INTO veic_perfil_fiscal_operacao (perfil_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, emite_nota_entrada, observacao,
      cbenef, cst_icms, reducao_base_icms_pct, reducao_base_icms_base_legal, ibs_cbs_cst, ibs_cbs_cclasstrib, inf_complementar_texto, natureza_operacao)
  SELECT v_id, company_id, operacao, cfop_dentro_uf, cfop_fora_uf, cst_ou_csosn, emite_nota_entrada, observacao,
      cbenef, cst_icms, reducao_base_icms_pct, reducao_base_icms_base_legal, ibs_cbs_cst, ibs_cbs_cclasstrib, inf_complementar_texto, natureza_operacao
    FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_apr.id;
  RETURN jsonb_build_object('ok', true, 'perfil_id', v_id, 'copiado_de', v_apr.id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_nova_versao(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_nova_versao(uuid,uuid) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES ('revenda.fiscal.alterar', '/dashboard/revenda/fiscal', 'Perfil fiscal', 'Alterar perfil aprovado',
  'Clique para abrir uma nova versão em rascunho, já com todos os valores do perfil aprovado.',
  'O perfil aprovado fica bloqueado para não mudar por engano. A nova versão só passa a valer quando for aprovada; até lá a emissão continua usando a atual.',
  'Mudou a alíquota de PIS: clique em Alterar, ajuste o PIS e aprove a nova versão.',
  'Achar que o clique já muda o que está valendo: não muda, só cria o rascunho.',
  'revenda_veiculos', 'publicado')
ON CONFLICT DO NOTHING;
