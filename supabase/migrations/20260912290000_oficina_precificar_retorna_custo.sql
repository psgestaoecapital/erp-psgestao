-- ============================================================
-- Onda 4B (backend) · fn_oficina_orcamento_precificar devolve custo_unitario por item
-- ============================================================
-- A tela de aprovação vai ter um campo de custo por peça (#1430 já persiste itens[].custo em
-- erp_os_diagnostico_item.custo_unitario). Para o campo PRÉ-PREENCHER com o que já foi informado
-- (e o mecânico ver o que ainda falta), a precificar precisa devolver custo_unitario por item.
-- Só adiciona esse campo ao JSON de cada item; nada mais muda. Assinatura inalterada (sem overload).

CREATE OR REPLACE FUNCTION public.fn_oficina_orcamento_precificar(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_ch jsonb; v_custo_hora numeric; v_margem numeric; v_item record; v_itens jsonb := '[]'::jsonb;
        v_sug numeric; v_pp jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF public.fn_oficina_papel(p_company_id) = 'CLIENT_OPERATOR' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_valor');
  END IF;
  v_ch := public.fn_oficina_custo_hora(p_company_id, 3);
  v_custo_hora := coalesce((v_ch->>'custo_hora')::numeric, 0);
  v_margem := coalesce((v_ch->>'margem_mao_obra_pct')::numeric, 0);

  FOR v_item IN
    SELECT i.id, i.tipo, i.descricao, i.servico_id, i.produto_id, i.quantidade,
           i.tempo_estimado_h, i.severidade, i.aprovado, i.preco, i.custo_unitario
      FROM erp_os_diagnostico_item i
      WHERE i.os_id = p_os_id AND i.company_id = p_company_id
      ORDER BY i.ordem, i.created_at
  LOOP
    v_sug := NULL;
    IF v_item.tipo = 'peca' AND v_item.produto_id IS NOT NULL THEN
      v_pp := public.fn_oficina_preco_peca(v_item.produto_id, p_company_id, coalesce(v_item.quantidade,1));
      IF coalesce((v_pp->>'ok')::boolean,false) THEN v_sug := (v_pp->>'preco')::numeric; END IF;
    ELSIF v_item.tipo = 'servico' AND v_item.tempo_estimado_h IS NOT NULL AND v_custo_hora > 0 THEN
      v_sug := round(v_item.tempo_estimado_h * v_custo_hora * (1 + v_margem/100.0), 2);
    END IF;
    v_itens := v_itens || jsonb_build_object(
      'item_id', v_item.id, 'tipo', v_item.tipo, 'descricao', v_item.descricao,
      'servico_id', v_item.servico_id, 'produto_id', v_item.produto_id,
      'quantidade', v_item.quantidade, 'tempo_estimado_h', v_item.tempo_estimado_h,
      'severidade', v_item.severidade, 'aprovado', v_item.aprovado,
      'preco', v_item.preco, 'preco_sugerido', v_sug,
      'custo_unitario', v_item.custo_unitario);   -- Onda 4B · custo informado (p/ pré-preencher o campo)
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'custo_hora', v_custo_hora, 'margem_mao_obra_pct', v_margem,
    'os', (SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'cliente_telefone', NULL, 'placa', o.placa,
             'marca', o.marca, 'modelo', o.modelo, 'diagnostico', o.diagnostico)
           FROM erp_os o WHERE o.id = p_os_id AND o.company_id = p_company_id),
    'itens', v_itens);
END $function$;
