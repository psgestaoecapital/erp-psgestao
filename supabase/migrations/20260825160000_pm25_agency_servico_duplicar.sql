-- PM-25 · Duplicar serviço no Catálogo (P&M). Reusa agency_servico + agency_pacote_item (RD-26).
-- Auditoria (RD-38): fn_agency_servico_salvar/_listar/_excluir já existem; falta só a de duplicar.
-- Copia todos os campos do original EXCETO id/nome/timestamps (nome := original || ' (cópia)') + os
-- itens do pacote (agency_pacote_item). Gated pelo mesmo helper fn_agency_assert. Não toca o original.

CREATE OR REPLACE FUNCTION public.fn_agency_servico_duplicar(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_comp uuid; v_novo uuid; v_nome text;
BEGIN
  SELECT company_id INTO v_comp FROM public.agency_servico WHERE id = p_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'servico_nao_encontrado'); END IF;
  PERFORM public.fn_agency_assert(v_comp);   -- gate (levanta exceção se sem acesso à empresa)

  INSERT INTO public.agency_servico (company_id, nome, descricao, tipo, area, modelo_preco, valor_base, unidade,
     periodicidade, horas_estimadas, prazo_dias_padrao, entregaveis, especificacoes, responsavel_padrao_id, ativo, ordem)
  SELECT company_id, nome || ' (cópia)', descricao, tipo, area, modelo_preco, valor_base, unidade,
     periodicidade, horas_estimadas, prazo_dias_padrao, entregaveis, especificacoes, responsavel_padrao_id, ativo, ordem
  FROM public.agency_servico WHERE id = p_id
  RETURNING id, nome INTO v_novo, v_nome;

  -- itens do pacote (se for tipo 'pacote') → mesmo conjunto no novo serviço
  INSERT INTO public.agency_pacote_item (company_id, pacote_id, servico_item_id, quantidade)
  SELECT company_id, v_novo, servico_item_id, quantidade
  FROM public.agency_pacote_item WHERE pacote_id = p_id
  ON CONFLICT (pacote_id, servico_item_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'novo_id', v_novo, 'nome', v_nome);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_agency_servico_duplicar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_servico_duplicar(uuid) TO authenticated;
