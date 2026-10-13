-- =============================================================
-- FEAT-OS-TOTAIS-RECALCULO-v1 · fn_os_salvar v3
-- =============================================================
-- Estende fn_os_salvar com 4 novos campos numericos e recalculo
-- automatico do total:
--
--   valor_servico, valor_materiais, valor_deslocamento, desconto_valor
--
-- Total = mao de obra (valor_hora * horas_executadas ou previstas)
--       + valor_servico
--       + valor_materiais
--       + valor_deslocamento
--       - desconto_valor
--
-- NULLIF('')::numeric protege string vazia do front.
-- horas_executadas tem precedencia · cai pra horas_previstas se 0/NULL.
--
-- Migration aplicada via MCP em 2026-06-12.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os erp_os%ROWTYPE; v_novo_status text := p_dados->>'status';
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
    ('aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada')
  THEN RETURN jsonb_build_object('ok', false, 'erro', 'Status invalido'); END IF;

  UPDATE erp_os SET
    equipamento=COALESCE(p_dados->>'equipamento',equipamento),
    defeito_relatado=COALESCE(p_dados->>'defeito_relatado',defeito_relatado),
    descricao_servico=COALESCE(p_dados->>'descricao_servico',descricao_servico),
    endereco_servico=COALESCE(p_dados->>'endereco_servico',endereco_servico),
    observacoes_cliente=COALESCE(p_dados->>'observacoes_cliente',observacoes_cliente),
    observacoes_internas=COALESCE(p_dados->>'observacoes_internas',observacoes_internas),
    tecnico_nome=COALESCE(p_dados->>'tecnico_nome',tecnico_nome),
    horas_previstas=COALESCE(NULLIF(p_dados->>'horas_previstas','')::numeric,horas_previstas),
    horas_executadas=COALESCE(NULLIF(p_dados->>'horas_executadas','')::numeric,horas_executadas),
    valor_hora=COALESCE(NULLIF(p_dados->>'valor_hora','')::numeric,valor_hora),
    valor_servico=COALESCE(NULLIF(p_dados->>'valor_servico','')::numeric,valor_servico),
    valor_materiais=COALESCE(NULLIF(p_dados->>'valor_materiais','')::numeric,valor_materiais),
    valor_deslocamento=COALESCE(NULLIF(p_dados->>'valor_deslocamento','')::numeric,valor_deslocamento),
    desconto_valor=COALESCE(NULLIF(p_dados->>'desconto_valor','')::numeric,desconto_valor),
    status=COALESCE(v_novo_status,status),
    data_execucao=CASE WHEN v_novo_status='em_execucao' AND data_execucao IS NULL THEN CURRENT_DATE ELSE data_execucao END,
    data_conclusao=CASE WHEN v_novo_status IN ('pronta','entregue') AND data_conclusao IS NULL THEN CURRENT_DATE ELSE data_conclusao END,
    updated_at=now()
  WHERE id=p_os_id RETURNING * INTO v_os;

  -- RECALCULO DO TOTAL
  UPDATE erp_os SET total =
      (COALESCE(valor_hora,0) * COALESCE(NULLIF(horas_executadas,0), horas_previstas, 0))
    + COALESCE(valor_servico,0) + COALESCE(valor_materiais,0)
    + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0)
  WHERE id=p_os_id RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok',true,'os_id',v_os.id,'status',v_os.status,'total',v_os.total);
END; $function$;
