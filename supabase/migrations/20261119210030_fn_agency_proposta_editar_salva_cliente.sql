-- BUG (Júlia/Pdois): editar a proposta para COLOCAR/TROCAR o cliente não salvava. A fn_agency_proposta_editar
-- atualizava título/itens/desconto/condição/prazo/validade/responsável/observações, mas o UPDATE OMITIA
-- cliente_id e erp_cliente_id → a escolha do cliente era descartada silenciosamente (mesmo com o cliente já
-- cadastrado). O fn_agency_proposta_criar já trata certo (grava os dois e resolve erp→agency via
-- fn_agency_cliente_resolver, que devolve/cria o agency_clientes da empresa). Aqui espelhamos esse comportamento
-- no editar. Só-aditivo no patch: só toca o cliente quando a chave vem no patch; todo o resto fica idêntico à
-- versão viva (conferido por diff — nenhum outro campo muda).
--
-- Provado no dado (RD-38, BEGIN..ROLLBACK, sob JWT de usuário real): editar com {erp_cliente_id} grava
-- erp_cliente_id e resolve cliente_id para o agency_clientes correto daquele erp (bate com o resolver). A versão
-- viva não gravava nenhum dos dois. SENSÍVEL (CREATE OR REPLACE de função existente) → MERGE AUTORIZADO.

CREATE OR REPLACE FUNCTION public.fn_agency_proposta_editar(p_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_itens jsonb; v_desc numeric; v_total numeric; v_final numeric;
  v_erp_present boolean; v_erp uuid; v_cliente_from_erp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM public.agency_propostas WHERE id = p_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- Cliente (espelha o criar): se veio erp_cliente_id, resolve/cria o agency_cliente da empresa.
  v_erp_present := p_patch ? 'erp_cliente_id';
  v_erp := CASE WHEN v_erp_present THEN NULLIF(p_patch->>'erp_cliente_id','')::uuid ELSE NULL END;
  IF v_erp_present AND v_erp IS NOT NULL THEN
    v_cliente_from_erp := fn_agency_cliente_resolver(v_comp, v_erp);
  END IF;

  UPDATE public.agency_propostas SET
    titulo             = COALESCE(NULLIF(btrim(p_patch->>'titulo'),''), titulo),
    descricao          = CASE WHEN p_patch ? 'descricao'          THEN NULLIF(p_patch->>'descricao','')                ELSE descricao END,
    itens              = COALESCE(p_patch->'itens', itens),
    desconto           = COALESCE(NULLIF(p_patch->>'desconto','')::numeric, desconto),
    condicao_pagamento = CASE WHEN p_patch ? 'condicao_pagamento' THEN NULLIF(p_patch->>'condicao_pagamento','')       ELSE condicao_pagamento END,
    prazo_execucao     = CASE WHEN p_patch ? 'prazo_execucao'     THEN NULLIF(p_patch->>'prazo_execucao','')::integer  ELSE prazo_execucao END,
    validade_proposta  = CASE WHEN p_patch ? 'validade_proposta'  THEN NULLIF(p_patch->>'validade_proposta','')::date  ELSE validade_proposta END,
    responsavel_id     = CASE WHEN p_patch ? 'responsavel_id'     THEN NULLIF(p_patch->>'responsavel_id','')::uuid     ELSE responsavel_id END,
    observacoes        = CASE WHEN p_patch ? 'observacoes'        THEN NULLIF(p_patch->>'observacoes','')              ELSE observacoes END,
    erp_cliente_id     = CASE WHEN v_erp_present THEN v_erp ELSE erp_cliente_id END,
    cliente_id         = CASE
                           WHEN v_erp_present           THEN COALESCE(v_cliente_from_erp, cliente_id)
                           WHEN p_patch ? 'cliente_id'  THEN NULLIF(p_patch->>'cliente_id','')::uuid
                           ELSE cliente_id
                         END,
    updated_at = now()
  WHERE id = p_id;

  SELECT itens, desconto INTO v_itens, v_desc FROM public.agency_propostas WHERE id = p_id;
  IF (p_patch ? 'valor_total') AND NULLIF(p_patch->>'valor_total','') IS NOT NULL THEN
    v_total := (p_patch->>'valor_total')::numeric;
  ELSE
    SELECT COALESCE(SUM(COALESCE(NULLIF(it->>'valor_total','')::numeric,
             COALESCE(NULLIF(it->>'quantidade','')::numeric,0) * COALESCE(NULLIF(it->>'valor_unitario','')::numeric,0))), 0)
      INTO v_total FROM jsonb_array_elements(COALESCE(v_itens,'[]'::jsonb)) it;
  END IF;
  v_final := GREATEST(v_total - COALESCE(v_desc,0), 0);
  UPDATE public.agency_propostas SET valor_total = v_total, valor_final = v_final WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'valor_total', v_total, 'valor_final', v_final);
END $function$;

-- ACL explícita (fail-closed): nunca anon; só usuário logado e serviço (preserva os grants vivos).
REVOKE ALL ON FUNCTION public.fn_agency_proposta_editar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_editar(uuid, jsonb) TO authenticated, service_role;
