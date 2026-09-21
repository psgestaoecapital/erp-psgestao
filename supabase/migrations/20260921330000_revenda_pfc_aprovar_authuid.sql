-- Revenda PF-c (follow-up do #1646) — "quem aprova/cria" é SEMPRE auth.uid(), nunca o p_user do cliente.
--
-- Depende do #1646 (migrations 29000/32000) já em produção. Aditivo/idempotente (CREATE OR REPLACE).
-- Decisão do CEO (21/09):
--  • fn_veic_perfil_fiscal_aprovar: v_quem := auth.uid() (o p_user do corpo é IGNORADO — falsificável).
--    Sem sessão (auth.uid IS NULL) só chega aqui service_role/PS (passa o gate por is_admin); nesse caso
--    o registro fica como 'sistema'. GATE MANTIDO: PS_ADMIN (is_admin) OU CLIENT_OWNER/CLIENT_MANAGER.
--  • mesma regra em salvar: criado_por := auth.uid() (não confia no p_user do cliente).
--  • audit_log_global ganha o resumo das operações (CFOP/CST) que passam a valer (item 4 do juiz).
--  • trigger de proteção passa a cobrir também vigente_desde (item 3 do juiz) — fechava só status/aprovado.

-- (aprovar) quem aprova = auth.uid(); gate inalterado; audit com operações + 'sistema' quando sem sessão.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_aprovar(p_perfil_id uuid, p_user uuid DEFAULT NULL, p_vigente_desde date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_status text; v_vig date; v_versao int; v_regime text; v_quem uuid; v_ops jsonb;
BEGIN
  v_quem := auth.uid();  -- SEMPRE o caller logado; p_user (cliente) é ignorado. NULL = service_role/PS.
  SELECT company_id, status, versao, regime INTO v_comp, v_status, v_versao, v_regime
    FROM veic_perfil_fiscal WHERE id = p_perfil_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'perfil_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- GATE MANTIDO (decisão do CEO): PS_ADMIN OU dono/adm da empresa (CLIENT_OWNER/CLIENT_MANAGER). Recusa clara.
  IF NOT (is_admin() OR EXISTS (
            SELECT 1 FROM tenant_user_roles
             WHERE user_id = v_quem AND company_id = v_comp
               AND role IN ('CLIENT_OWNER','CLIENT_MANAGER') AND is_active = true)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_aprovar',
      'mensagem', 'Só o dono/administrador da revenda (ou o suporte PS) aprova o perfil fiscal.'); END IF;
  IF v_status NOT IN ('rascunho','aguardando_aprovacao') THEN RETURN jsonb_build_object('ok', false, 'erro', 'estado_invalido', 'status', v_status); END IF;
  v_vig := COALESCE(p_vigente_desde, current_date);
  SELECT jsonb_agg(jsonb_build_object('operacao',operacao,'cfop_dentro_uf',cfop_dentro_uf,
           'cfop_fora_uf',cfop_fora_uf,'cst_ou_csosn',cst_ou_csosn) ORDER BY operacao)
    INTO v_ops FROM veic_perfil_fiscal_operacao WHERE perfil_id = p_perfil_id;

  PERFORM set_config('app.perfil_fiscal_transicao', 'on', true);
  UPDATE veic_perfil_fiscal SET status = 'substituido', updated_at = now()
   WHERE company_id = v_comp AND status = 'aprovado' AND id <> p_perfil_id AND vigente_desde <= v_vig;
  UPDATE veic_perfil_fiscal SET status = 'aprovado', aprovado_por = v_quem, aprovado_em = now(), vigente_desde = v_vig, updated_at = now()
   WHERE id = p_perfil_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v_comp, v_quem, 'veic_perfil_fiscal', p_perfil_id::text, 'perfil_fiscal_aprovado',
          jsonb_build_object('versao', v_versao, 'vigente_desde', v_vig, 'regime', v_regime,
                             'status_anterior', v_status, 'aprovado_por', COALESCE(v_quem::text, 'sistema'),
                             'operacoes', COALESCE(v_ops, '[]'::jsonb)));
  RETURN jsonb_build_object('ok', true, 'status', 'aprovado', 'vigente_desde', v_vig, 'versao', v_versao);
END $function$;

-- (salvar) mesma regra: criado_por = auth.uid() (não confia no p_user do cliente). Resto idêntico ao #1646.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_salvar(p_company_id uuid, p_dados jsonb, p_operacoes jsonb DEFAULT NULL, p_por text DEFAULT 'empresa', p_user uuid DEFAULT NULL)
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
    VALUES (p_company_id, COALESCE((SELECT max(versao) FROM veic_perfil_fiscal WHERE company_id=p_company_id),0)+1,
            'rascunho', p_por, auth.uid())
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
-- (enviar não grava "quem" — só muda status; nada a alterar ali.)

-- (guard) protege também vigente_desde — fecha o UPDATE direto da data de vigência fora da RPC.
CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.perfil_fiscal_transicao', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.status,'rascunho') <> 'rascunho' OR NEW.aprovado_por IS NOT NULL OR NEW.aprovado_em IS NOT NULL THEN
      RAISE EXCEPTION 'perfil_fiscal: status/aprovação só mudam via fn_veic_perfil_fiscal_enviar/_aprovar';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.aprovado_por IS DISTINCT FROM OLD.aprovado_por
     OR NEW.aprovado_em IS DISTINCT FROM OLD.aprovado_em
     OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde THEN
    RAISE EXCEPTION 'perfil_fiscal: status/aprovação/vigência só mudam via fn_veic_perfil_fiscal_enviar/_aprovar';
  END IF;
  RETURN NEW;
END $function$;
