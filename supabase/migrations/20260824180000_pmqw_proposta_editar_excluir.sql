-- PM-QW #15 · Propostas P&M: editar + excluir (soft). Auditoria (RD-38): agency_propostas tem
-- status (rascunho/aprovada/recusada) e fn_agency_proposta_criar/_aprovar — NÃO havia editar/excluir,
-- nem deleted_at. Adiciono deleted_at (soft-delete padrão do repo — RD-52, não sobrecarrego status)
-- + 2 RPCs gated. As listagens passam a filtrar deleted_at IS NULL.

ALTER TABLE public.agency_propostas ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Editar (patch): atualiza só os campos presentes em p_patch; recalcula valor_total/valor_final
-- (do jsonb itens ou de valor_total explícito), igual ao fn_agency_proposta_criar. Gated.
CREATE OR REPLACE FUNCTION public.fn_agency_proposta_editar(p_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_comp uuid; v_itens jsonb; v_desc numeric; v_total numeric; v_final numeric;
BEGIN
  SELECT company_id INTO v_comp FROM public.agency_propostas WHERE id = p_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

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
END $fn$;

-- Excluir (soft — RD-30): marca deleted_at. Some da lista; não apaga fisicamente.
CREATE OR REPLACE FUNCTION public.fn_agency_proposta_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_comp uuid; v_del timestamptz;
BEGIN
  SELECT company_id, deleted_at INTO v_comp, v_del FROM public.agency_propostas WHERE id = p_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'proposta_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_del IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_excluida', true, 'id', p_id); END IF;
  UPDATE public.agency_propostas SET deleted_at = now(), updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_agency_proposta_editar(uuid,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agency_proposta_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_editar(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_proposta_excluir(uuid) TO authenticated;
