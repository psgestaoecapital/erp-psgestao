-- #5622 (Alliance Veículos) — Perfil fiscal da revenda: gravar o "NCM padrão" (coluna veic_perfil_fiscal.ncm_padrao já existe).
-- Só o corpo de fn_veic_perfil_fiscal_salvar muda (derivado da versão viva, pós #5616): +1 linha para ncm_padrao,
-- aceitando só dígitos (máscara 8703.22.10 vira 87032210). Assinatura, grants e gate de aprovação intactos.
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

REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_salvar(uuid,jsonb,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_salvar(uuid,jsonb,jsonb,text,uuid) TO authenticated, service_role;
