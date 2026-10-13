-- R9a · Tela 11 (perfil fiscal): histórico de aprovações com QUEM (nome), quando e observação; e o
-- estado do convite ao contador (para quem, quando, quando vence). Nada muda na regra fiscal — só o obter
-- passa a devolver mais contexto, e um cancelar de convite. SECURITY DEFINER sem anon (CEO/RD).

CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_obter(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_edit record; v_ops jsonb; v_vig jsonb; v_hist jsonb; v_conv jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_vig := fn_veic_perfil_fiscal_vigente(p_company_id);
  SELECT * INTO v_edit FROM veic_perfil_fiscal
   WHERE company_id = p_company_id AND status IN ('rascunho','aguardando_aprovacao')
   ORDER BY versao DESC LIMIT 1;
  IF FOUND THEN
    SELECT jsonb_agg(jsonb_build_object('operacao',operacao,'cfop_dentro_uf',cfop_dentro_uf,'cfop_fora_uf',cfop_fora_uf,
             'cst_ou_csosn',cst_ou_csosn,'emite_nota_entrada',emite_nota_entrada,'observacao',observacao,
             'cbenef',cbenef,'cst_icms',cst_icms,'reducao_base_icms_pct',reducao_base_icms_pct,
             'reducao_base_icms_base_legal',reducao_base_icms_base_legal,'ibs_cbs_cst',ibs_cbs_cst,
             'ibs_cbs_cclasstrib',ibs_cbs_cclasstrib,'inf_complementar_texto',inf_complementar_texto,
             'natureza_operacao',natureza_operacao) ORDER BY operacao)
      INTO v_ops FROM veic_perfil_fiscal_operacao WHERE perfil_id = v_edit.id;
  END IF;
  -- R9a · histórico com QUEM aprovou (nome), quando, versão, vigência e a observação daquela versão ("o que mudou")
  SELECT jsonb_agg(jsonb_build_object('id',id,'versao',versao,'status',status,'vigente_desde',vigente_desde,
           'aprovado_em',aprovado_em,'aprovado_por_nome', CASE WHEN aprovado_por IS NOT NULL THEN fn_usuario_nome(aprovado_por) END,
           'preenchido_por',preenchido_por,'observacao',observacao) ORDER BY versao DESC)
    INTO v_hist FROM veic_perfil_fiscal WHERE company_id = p_company_id;

  -- R9a · convite mais recente ao contador (status/para quem/quando/vence)
  SELECT to_jsonb(t) INTO v_conv FROM (
    SELECT email_contador AS email, status, criado_em, expira_em, usado_em,
           (status = 'pendente' AND expira_em IS NOT NULL AND expira_em < now()) AS expirado
    FROM veic_perfil_convite WHERE company_id = p_company_id ORDER BY criado_em DESC LIMIT 1
  ) t;

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
    'historico', COALESCE(v_hist, '[]'::jsonb),
    'convite', v_conv);
END $function$;

-- cancelar o convite pendente ao contador (o "cancelar" da tela). Não apaga histórico.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_convite_cancelar(p_company_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_perfil_convite SET status = 'cancelado'
   WHERE company_id = p_company_id AND status = 'pendente';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'cancelados', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_veic_perfil_convite_cancelar(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_convite_cancelar(uuid,uuid) TO authenticated, service_role;
