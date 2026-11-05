-- Chamado #6698 (Alliance, todas as revendas): "Falha ao carregar o perfil" CONTINUOU após a #3882.
-- Causa (provada nos logs: sql_state 55000 "tuple structure of a not-yet-assigned record is indeterminate"):
-- com rascunho existente o SELECT INTO v_apr não roda e o RETURN ainda referenciava o record v_apr (to_jsonb(v_apr),
-- v_apr.aprovado_por); o PL/pgSQL precisa da estrutura do record ao PLANEJAR a expressão, o CASE não evita.
-- Correção: o JSON do aprovado é montado DENTRO do ramo em que v_apr existe (v_apr_json); o RETURN só usa v_apr_json.
-- Mesmo contrato de retorno (ok, vigente, editavel, aprovado, historico, convite). Plano de volta: reaplicar 20261104182030.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_obter(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_edit record; v_apr record; v_ops jsonb; v_ops_apr jsonb; v_vig jsonb; v_hist jsonb; v_conv jsonb; v_apr_json jsonb;
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
      v_apr_json := (to_jsonb(v_apr) - 'company_id' - 'criado_por' - 'aprovado_por' - 'criado_em' - 'updated_at')
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
    'aprovado', v_apr_json,
    'historico', COALESCE(v_hist, '[]'::jsonb),
    'convite', v_conv);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid) TO authenticated, service_role;
