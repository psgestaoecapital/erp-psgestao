-- [bug] Consignação (CST 41) recusa por cBenef/redução incompatível (spec 26/11 · Code: rodrigo-manual).
-- Núcleo fiscal — NÃO mergear sem revisão do Eng. Chefe.
--
-- DECISÃO DO SÓCIO (ajuste 27/11): NÃO alterar cadastro/dado de perfil. O cBenef é específico de cada empresa e
-- fica como está — quem resolve a nota é o EMISSOR (icmsVeiculoPorCst, no código), não mexer no dado. Por isso esta
-- migration NÃO limpa mais cbenef/redução de nenhuma operação; ela traz apenas a guarda genérica abaixo.
--
-- Item 2 (validação do perfil, só config NOVA): ao APROVAR um perfil fiscal, bloquear quando uma operação de CST NÃO
--   tributada (40/41/50/60) trouxer REDUÇÃO de base — isso é o pacote do CST 20; a SEFAZ rejeita. Chokepoint único (o
--   perfil só emite quando aprovado), cobrindo o save da empresa e o do contador. NÃO toca dado já existente: só barra
--   a nova aprovação inconsistente; perfis já aprovados seguem intactos e o emissor garante o XML válido. O cBenef
--   incompatível é tratado no emissor (monta o ICMS estritamente pelo CST); validar cBenef×CST×UF no save exigiria a
--   tabela da SEFAZ/SC, que não temos aqui.

CREATE OR REPLACE FUNCTION public.fn_veic_perfil_fiscal_aprovar(p_perfil_id uuid, p_user uuid DEFAULT NULL::uuid, p_vigente_desde date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- #bug consignação · CST não tributada (40/41/50/60) NÃO leva redução de base (é pacote do CST 20). A SEFAZ rejeita
  -- e a nota não sai. Bloqueia a aprovação, nomeando a operação, em vez de deixar emitir errado. (cBenef incompatível
  -- é saneado no emissor, que monta o ICMS estritamente pelo CST.) Só barra config NOVA; não altera dado existente.
  IF EXISTS (
    SELECT 1 FROM veic_perfil_fiscal_operacao o
     WHERE o.perfil_id = p_perfil_id
       AND regexp_replace(coalesce(o.cst_ou_csosn,''),'[^0-9]','','g') IN ('40','41','50','60','040','041','050','060')
       AND coalesce(o.reducao_base_icms_pct, 0) <> 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cst_nao_tributada_com_reducao',
      'mensagem', 'Há operação com CST não tributada (40/41/50/60) e redução de base no perfil. CST não tributada não leva redução (isso é do CST 20) — a SEFAZ rejeita. Remova a redução dessas operações e aprove de novo.',
      'operacoes', (SELECT jsonb_agg(o.operacao ORDER BY o.operacao) FROM veic_perfil_fiscal_operacao o
                     WHERE o.perfil_id = p_perfil_id
                       AND regexp_replace(coalesce(o.cst_ou_csosn,''),'[^0-9]','','g') IN ('40','41','50','60','040','041','050','060')
                       AND coalesce(o.reducao_base_icms_pct, 0) <> 0));
  END IF;

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

-- Guarda da função (check:fn-guards · REVOKE anon): SECURITY DEFINER recriada → fecha anon/PUBLIC e abre só para
-- logado/serviço, com a assinatura exata. A função já exige CLIENT_OWNER/CLIENT_MANAGER (ou PS) no corpo.
REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_aprovar(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_perfil_fiscal_aprovar(uuid, uuid, date) TO authenticated, service_role;
