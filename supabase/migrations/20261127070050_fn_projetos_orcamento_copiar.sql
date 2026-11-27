-- Hub · tela 108 (HB2 Engenharia) · "Cópia de Orçamento" — copiar orçamento de outra obra
-- Blueprint hub_projetos essencial: "ADOTAR copiar orçamento de outra obra ou de modelo".
--
-- fn_projetos_orcamento_copiar(destino, origem): copia TODOS os itens vivos do orçamento de
-- origem para o de destino (novos ids), preservando o complemento EAP 1:1
-- (projetos_orcamento_item_eap). Aditiva (função NOVA; não altera nada existente).
--
-- Isolamento de tenant (mesma guarda da fn_projetos_orcamento_eap_importar, já em produção):
--   * destino e origem têm de pertencer a uma empresa do usuário (get_user_company_ids());
--   * origem e destino têm de ser da MESMA empresa (não copia entre tenants).
-- SECURITY DEFINER + company guard; REVOKE anon.
--
-- Prova RD-38 (BEGIN..ROLLBACK, DEMO 006, orçamento 5a13214a…, 25/11/2026):
--   origem itens=8 / eap=3 / sum(subtotal)=690902.50  ==  destino 8 / 3 / 690902.50  (OK=t).

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_copiar(
  p_orcamento_destino uuid,
  p_orcamento_origem  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company        uuid;
  v_company_origem uuid;
  v_itens int := 0;
  v_eap   int := 0;
  v_tmp   int;
  v_new   uuid;
  r       record;
BEGIN
  IF p_orcamento_destino IS NULL OR p_orcamento_origem IS NULL THEN
    RAISE EXCEPTION 'origem e destino são obrigatórios' USING ERRCODE = '22023';
  END IF;
  IF p_orcamento_destino = p_orcamento_origem THEN
    RAISE EXCEPTION 'origem e destino não podem ser o mesmo orçamento' USING ERRCODE = '22023';
  END IF;

  -- destino: tem de ser de uma empresa do usuário
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_destino
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento de destino %', p_orcamento_destino USING ERRCODE = '42501';
  END IF;

  -- origem: também do usuário E da MESMA empresa do destino (isolamento de tenant)
  SELECT o.company_id INTO v_company_origem
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_origem
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company_origem IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento de origem %', p_orcamento_origem USING ERRCODE = '42501';
  END IF;
  IF v_company_origem <> v_company THEN
    RAISE EXCEPTION 'origem e destino de empresas diferentes' USING ERRCODE = '42501';
  END IF;

  -- copia cada item VIVO da origem, com o complemento EAP 1:1 quando houver
  FOR r IN
    SELECT * FROM public.erp_orcamentos_itens
    WHERE orcamento_id = p_orcamento_origem
      AND company_id = v_company
      AND excluido_em IS NULL
    ORDER BY ordem, created_at
  LOOP
    INSERT INTO public.erp_orcamentos_itens
      (orcamento_id, company_id, ordem, produto_id, produto_codigo, produto_nome, produto_descricao,
       unidade, quantidade, preco_unitario, preco_custo, desconto_percentual, desconto_valor, subtotal,
       margem_percentual, observacoes, tipo_item, servico_id, servico_codigo, servico_descricao,
       bdi_percentual, aliquota_iss, iss_retido, valor_iss, setor_id, centro_custo_id,
       categoria_despesa, frente, reembolsavel)
    VALUES
      (p_orcamento_destino, v_company, r.ordem, r.produto_id, r.produto_codigo, r.produto_nome, r.produto_descricao,
       r.unidade, r.quantidade, r.preco_unitario, r.preco_custo, r.desconto_percentual, r.desconto_valor, r.subtotal,
       r.margem_percentual, r.observacoes, r.tipo_item, r.servico_id, r.servico_codigo, r.servico_descricao,
       r.bdi_percentual, r.aliquota_iss, r.iss_retido, r.valor_iss, r.setor_id, r.centro_custo_id,
       r.categoria_despesa, r.frente, r.reembolsavel)
    RETURNING id INTO v_new;
    v_itens := v_itens + 1;

    INSERT INTO public.projetos_orcamento_item_eap
      (orcamento_item_id, company_id, eap_codigo, ref_padrao_codigo, local_tipo, local_nome,
       quantidade, custo_material_unit, custo_mao_obra_unit, origem)
    SELECT v_new, v_company, e.eap_codigo, e.ref_padrao_codigo, e.local_tipo, e.local_nome,
           e.quantidade, e.custo_material_unit, e.custo_mao_obra_unit, e.origem
    FROM public.projetos_orcamento_item_eap e
    WHERE e.orcamento_item_id = r.id;
    GET DIAGNOSTICS v_tmp = ROW_COUNT;
    v_eap := v_eap + v_tmp;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'orcamento_destino', p_orcamento_destino,
    'orcamento_origem',  p_orcamento_origem,
    'itens_copiados', v_itens,
    'eap_copiados',   v_eap
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_copiar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_copiar(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_projetos_orcamento_copiar(uuid, uuid) IS
  'Hub tela 108: copia os itens (e complemento EAP) de um orçamento de origem para o de destino, mesma empresa do usuário. Aditiva; guarda de tenant igual à fn_projetos_orcamento_eap_importar.';
