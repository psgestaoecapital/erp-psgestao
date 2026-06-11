-- =============================================================
-- FEAT-OS-ONDA4-O42-EXECUCAO-v1 · Onda 4.2 da trilha OS
-- =============================================================
-- Execucao (responsavel + horas) generico.
-- Estende fn_os_salvar com tecnico_nome, horas_previstas,
-- horas_executadas, valor_hora.
--
-- Horas/valor-hora na OS sao INFORMATIVOS · nao alteram total
-- do pedido nem faturamento (segue pela cadeia OTC).
--
-- NULLIF(p_dados->>'campo','') protege contra string vazia
-- vinda do front (input numerico desabitado preserva o valor atual).
--
-- Migration aplicada via MCP em 2026-06-11.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_os erp_os%ROWTYPE;
  v_novo_status text := p_dados->>'status';
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada');
  END IF;

  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
     ('aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status invalido');
  END IF;

  UPDATE erp_os SET
    equipamento          = COALESCE(p_dados->>'equipamento', equipamento),
    defeito_relatado     = COALESCE(p_dados->>'defeito_relatado', defeito_relatado),
    descricao_servico    = COALESCE(p_dados->>'descricao_servico', descricao_servico),
    endereco_servico     = COALESCE(p_dados->>'endereco_servico', endereco_servico),
    observacoes_cliente  = COALESCE(p_dados->>'observacoes_cliente', observacoes_cliente),
    observacoes_internas = COALESCE(p_dados->>'observacoes_internas', observacoes_internas),
    -- O4.2 execucao
    tecnico_nome         = COALESCE(p_dados->>'tecnico_nome', tecnico_nome),
    horas_previstas      = COALESCE(NULLIF(p_dados->>'horas_previstas','')::numeric, horas_previstas),
    horas_executadas     = COALESCE(NULLIF(p_dados->>'horas_executadas','')::numeric, horas_executadas),
    valor_hora           = COALESCE(NULLIF(p_dados->>'valor_hora','')::numeric, valor_hora),
    status               = COALESCE(v_novo_status, status),
    data_execucao        = CASE WHEN v_novo_status='em_execucao' AND data_execucao IS NULL THEN CURRENT_DATE ELSE data_execucao END,
    data_conclusao       = CASE WHEN v_novo_status IN ('pronta','entregue') AND data_conclusao IS NULL THEN CURRENT_DATE ELSE data_conclusao END,
    updated_at           = now()
  WHERE id = p_os_id RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'os_id', v_os.id, 'status', v_os.status,
    'horas_executadas', v_os.horas_executadas, 'valor_hora', v_os.valor_hora);
END; $$;
