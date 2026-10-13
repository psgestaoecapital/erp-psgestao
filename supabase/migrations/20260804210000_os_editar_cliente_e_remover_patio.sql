-- RD-41 · Oficina (KGF/Kleiton): (1) editar/re-vincular o CLIENTE da OS em qualquer status;
-- (2) remover veículo do pátio com salvaguarda (RD-55: soft-delete, checa vínculo, nunca apaga físico).

-- (1) fn_os_salvar já grava cliente_nome/cliente_cnpj em qualquer status (a trava era só no front).
--     Additivo: passa a aceitar cliente_id (re-vínculo a outro cadastro). Resto IDÊNTICO ao vigente.
CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_os erp_os%ROWTYPE; v_novo_status text := p_dados->>'status'; v_faturada boolean; v_antes jsonb;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;

  IF v_os.company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;

  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
    ('aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada')
  THEN RETURN jsonb_build_object('ok', false, 'erro', 'Status invalido'); END IF;

  v_faturada := COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL;
  IF v_faturada AND (
       (p_dados ? 'valor_servico'      AND NULLIF(p_dados->>'valor_servico','')::numeric      IS DISTINCT FROM v_os.valor_servico)
    OR (p_dados ? 'valor_materiais'    AND NULLIF(p_dados->>'valor_materiais','')::numeric    IS DISTINCT FROM v_os.valor_materiais)
    OR (p_dados ? 'valor_deslocamento' AND NULLIF(p_dados->>'valor_deslocamento','')::numeric IS DISTINCT FROM v_os.valor_deslocamento)
    OR (p_dados ? 'valor_hora'         AND NULLIF(p_dados->>'valor_hora','')::numeric         IS DISTINCT FROM v_os.valor_hora)
    OR (p_dados ? 'desconto_valor'     AND NULLIF(p_dados->>'desconto_valor','')::numeric     IS DISTINCT FROM v_os.desconto_valor)
    OR (p_dados ? 'horas_previstas'    AND NULLIF(p_dados->>'horas_previstas','')::numeric    IS DISTINCT FROM v_os.horas_previstas)
    OR (p_dados ? 'horas_executadas'   AND NULLIF(p_dados->>'horas_executadas','')::numeric   IS DISTINCT FROM v_os.horas_executadas)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'faturada', true,
      'erro', 'OS faturada: os valores não podem ser alterados (já virou lançamento na GE). Dados do veículo/cliente podem.');
  END IF;

  v_antes := jsonb_build_object('placa', v_os.placa, 'cliente_id', v_os.cliente_id, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
    'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total);

  UPDATE erp_os SET
    placa=COALESCE(NULLIF(upper(regexp_replace(COALESCE(p_dados->>'placa',''), '[^A-Za-z0-9]', '', 'g')),''), placa),
    modelo=COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    marca=COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    ano=COALESCE(NULLIF(p_dados->>'ano','')::int, ano),
    km=COALESCE(NULLIF(p_dados->>'km','')::int, km),
    chassi=COALESCE(NULLIF(btrim(p_dados->>'chassi'),''), chassi),
    -- re-vínculo do cliente (RD-26): só toca cliente_id quando a chave vem no payload.
    cliente_id=CASE WHEN p_dados ? 'cliente_id' THEN NULLIF(btrim(p_dados->>'cliente_id'),'')::uuid ELSE cliente_id END,
    cliente_nome=COALESCE(NULLIF(btrim(p_dados->>'cliente_nome'),''), cliente_nome),
    cliente_cnpj=COALESCE(NULLIF(btrim(p_dados->>'cliente_cnpj'),''), cliente_cnpj),
    equipamento=COALESCE(p_dados->>'equipamento',equipamento),
    defeito_relatado=COALESCE(p_dados->>'defeito_relatado',defeito_relatado),
    descricao_servico=COALESCE(p_dados->>'descricao_servico',descricao_servico),
    endereco_servico=COALESCE(p_dados->>'endereco_servico',endereco_servico),
    observacoes_cliente=COALESCE(p_dados->>'observacoes_cliente',observacoes_cliente),
    observacoes_internas=COALESCE(p_dados->>'observacoes_internas',observacoes_internas),
    prioridade=COALESCE(NULLIF(p_dados->>'prioridade',''), prioridade),
    tecnico_nome=COALESCE(p_dados->>'tecnico_nome',tecnico_nome),
    horas_previstas=CASE WHEN v_faturada THEN horas_previstas ELSE COALESCE(NULLIF(p_dados->>'horas_previstas','')::numeric,horas_previstas) END,
    horas_executadas=CASE WHEN v_faturada THEN horas_executadas ELSE COALESCE(NULLIF(p_dados->>'horas_executadas','')::numeric,horas_executadas) END,
    valor_hora=CASE WHEN v_faturada THEN valor_hora ELSE COALESCE(NULLIF(p_dados->>'valor_hora','')::numeric,valor_hora) END,
    valor_servico=CASE WHEN v_faturada THEN valor_servico ELSE COALESCE(NULLIF(p_dados->>'valor_servico','')::numeric,valor_servico) END,
    valor_materiais=CASE WHEN v_faturada THEN valor_materiais ELSE COALESCE(NULLIF(p_dados->>'valor_materiais','')::numeric,valor_materiais) END,
    valor_deslocamento=CASE WHEN v_faturada THEN valor_deslocamento ELSE COALESCE(NULLIF(p_dados->>'valor_deslocamento','')::numeric,valor_deslocamento) END,
    desconto_valor=CASE WHEN v_faturada THEN desconto_valor ELSE COALESCE(NULLIF(p_dados->>'desconto_valor','')::numeric,desconto_valor) END,
    status=COALESCE(v_novo_status,status),
    data_execucao=CASE WHEN v_novo_status='em_execucao' AND data_execucao IS NULL THEN CURRENT_DATE ELSE data_execucao END,
    data_conclusao=CASE WHEN v_novo_status IN ('pronta','entregue') AND data_conclusao IS NULL THEN CURRENT_DATE ELSE data_conclusao END,
    updated_at=now()
  WHERE id=p_os_id RETURNING * INTO v_os;

  IF NOT v_faturada THEN
    UPDATE erp_os SET total =
        (COALESCE(valor_hora,0) * COALESCE(NULLIF(horas_executadas,0), horas_previstas, 0))
      + COALESCE(valor_servico,0) + COALESCE(valor_materiais,0)
      + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0)
    WHERE id=p_os_id RETURNING * INTO v_os;
  END IF;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, auth.uid(), (SELECT email FROM users WHERE id=auth.uid()),
      'erp_os', v_os.id::text, 'EDITOU', v_antes,
      jsonb_build_object('placa', v_os.placa, 'cliente_id', v_os.cliente_id, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
        'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok',true,'os_id',v_os.id,'status',v_os.status,'total',v_os.total);
END; $function$;

-- (2) Remover do pátio com salvaguarda. Sem vínculo → soft-delete (excluida). Com vínculo (pedido,
-- faturamento, apontamento de serviço, peça solicitada) → NÃO remove: retorna mensagem explicativa;
-- o operador pode então CANCELAR a OS (soft, mantém histórico) passando p_forcar_cancelar + motivo.
-- Nunca apaga fisicamente (RD-55). Linguagem de operador no retorno (REMOVEU/CANCELOU).
CREATE OR REPLACE FUNCTION public.fn_os_remover_do_patio(p_os_id uuid, p_motivo text DEFAULT NULL::text, p_forcar_cancelar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os erp_os%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo,'')), '');
  v_pedido boolean; v_faturada boolean; v_apont int; v_pecas int; v_vinculo boolean; v_acao text;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  IF v_os.company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS'); END IF;

  IF v_os.excluida THEN RETURN jsonb_build_object('ok', true, 'acao', 'removida', 'numero', v_os.numero, 'ja_estava', true); END IF;
  IF v_os.status = 'cancelada' THEN RETURN jsonb_build_object('ok', true, 'acao', 'cancelada', 'numero', v_os.numero, 'ja_estava', true); END IF;

  v_pedido   := v_os.pedido_id IS NOT NULL;
  v_faturada := COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL;
  SELECT count(*) INTO v_apont FROM erp_os_apontamento WHERE os_id = p_os_id;
  SELECT count(*) INTO v_pecas FROM erp_os_peca_solicitacao WHERE os_id = p_os_id;
  v_vinculo := v_pedido OR v_faturada OR v_apont > 0 OR v_pecas > 0;

  -- Caso B: tem vínculo e não pediu pra cancelar → bloqueia com explicação (não apaga).
  IF v_vinculo AND NOT p_forcar_cancelar THEN
    RETURN jsonb_build_object(
      'ok', false, 'bloqueada', true, 'numero', v_os.numero,
      'vinculos', jsonb_build_object('pedido', v_pedido, 'faturada', v_faturada, 'apontamentos', v_apont, 'pecas', v_pecas),
      'mensagem', 'Esta OS já tem ' ||
        array_to_string(ARRAY[
          CASE WHEN v_pedido OR v_faturada THEN 'pedido/faturamento' END,
          CASE WHEN v_apont > 0 THEN 'serviço apontado' END,
          CASE WHEN v_pecas > 0 THEN 'peça solicitada' END
        ]::text[], ', ') ||
        ' lançado. Para remover, cancele antes o pedido/lançamento — ou cancele a OS (mantém o histórico).');
  END IF;

  IF v_vinculo THEN
    -- Caso B forçado: cancela (soft, mantém histórico financeiro). Motivo obrigatório.
    IF v_motivo IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'precisa_motivo', true, 'erro', 'Informe o motivo do cancelamento.'); END IF;
    UPDATE erp_os SET status='cancelada', cancelada_em=now(), cancelada_por=auth.uid(), cancelada_motivo=v_motivo, updated_at=now()
    WHERE id=p_os_id;
    v_acao := 'cancelada';
  ELSE
    -- Caso A: sem vínculo → remove do pátio (soft-delete, mantém rastro).
    UPDATE erp_os SET excluida=true, excluida_em=now(), excluida_por=auth.uid(), excluida_motivo=v_motivo, updated_at=now()
    WHERE id=p_os_id;
    v_acao := 'removida';
  END IF;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, auth.uid(), (SELECT email FROM users WHERE id=auth.uid()),
      'erp_os', v_os.id::text,
      CASE WHEN v_acao='cancelada' THEN 'CANCELOU' ELSE 'REMOVEU_PATIO' END,
      jsonb_build_object('numero', v_os.numero, 'status', v_os.status, 'pedido_id', v_os.pedido_id, 'titulos_gerados', v_os.titulos_gerados),
      jsonb_build_object('acao', v_acao, 'motivo', v_motivo, 'apontamentos', v_apont, 'pecas', v_pecas));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'acao', v_acao, 'numero', v_os.numero,
    'vinculos', jsonb_build_object('pedido', v_pedido, 'faturada', v_faturada, 'apontamentos', v_apont, 'pecas', v_pecas));
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_remover_do_patio(uuid, text, boolean) TO authenticated;
