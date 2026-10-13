-- OS · EDITAR/EXCLUIR como função permanente (RD-26 sobre o que já existe).
-- Auditoria: fn_os_excluir já é SOFT delete + guard de faturada + trilha; fn_os_salvar edita mas
-- NÃO registra trilha e deixa mexer em valores de OS faturada. Decisão do CEO: exclusão fica p/
-- qualquer usuário, MAS com histórico sempre. Aqui: trilha na edição + guard-faturada na edição +
-- fn_os_restaurar (desfazer exclusão) + marcar as OS de teste com [TESTE] (sem apagar nada).
-- 🔒 soft delete sempre. Linguagem Excluir/Restaurar. RD-45 escopo por empresa.

-- 1 · fn_os_salvar: + guard de faturada nos VALORES + trilha em audit_log_global (edição rastreada).
CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  -- 🔒 GUARD FATURADA: OS que virou lançamento na GE não pode ter VALORES alterados (regressão financeira).
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

  v_antes := jsonb_build_object('placa', v_os.placa, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
    'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total);

  UPDATE erp_os SET
    placa=COALESCE(NULLIF(upper(regexp_replace(COALESCE(p_dados->>'placa',''), '[^A-Za-z0-9]', '', 'g')),''), placa),
    modelo=COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    marca=COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    ano=COALESCE(NULLIF(p_dados->>'ano','')::int, ano),
    km=COALESCE(NULLIF(p_dados->>'km','')::int, km),
    chassi=COALESCE(NULLIF(btrim(p_dados->>'chassi'),''), chassi),
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

  -- total só recalcula quando NÃO faturada (faturada preserva o total que virou título)
  IF NOT v_faturada THEN
    UPDATE erp_os SET total =
        (COALESCE(valor_hora,0) * COALESCE(NULLIF(horas_executadas,0), horas_previstas, 0))
      + COALESCE(valor_servico,0) + COALESCE(valor_materiais,0)
      + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0)
    WHERE id=p_os_id RETURNING * INTO v_os;
  END IF;

  -- TRILHA da edição (antes/depois). Não deixa a edição sem histórico (decisão CEO).
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, auth.uid(), (SELECT email FROM users WHERE id=auth.uid()),
      'erp_os', v_os.id::text, 'EDITOU', v_antes,
      jsonb_build_object('placa', v_os.placa, 'cliente_nome', v_os.cliente_nome, 'modelo', v_os.modelo,
        'marca', v_os.marca, 'km', v_os.km, 'defeito_relatado', v_os.defeito_relatado, 'status', v_os.status, 'total', v_os.total));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok',true,'os_id',v_os.id,'status',v_os.status,'total',v_os.total);
END; $function$;

-- 2 · fn_os_restaurar: desfaz a exclusão (soft). Com trilha. Linguagem "Restaurar".
CREATE OR REPLACE FUNCTION public.fn_os_restaurar(p_os_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_os erp_os%ROWTYPE;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;
  IF v_os.company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS'); END IF;
  IF NOT COALESCE(v_os.excluida, false) THEN
    RETURN jsonb_build_object('ok', true, 'numero', v_os.numero, 'ja_estava', true); END IF;

  UPDATE erp_os SET excluida=false, excluida_em=NULL, excluida_por=NULL, excluida_motivo=NULL, updated_at=now()
  WHERE id = p_os_id;

  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_os.company_id, auth.uid(), (SELECT email FROM users WHERE id=auth.uid()),
      'erp_os', v_os.id::text, 'RESTAUROU',
      jsonb_build_object('excluida', true, 'excluida_motivo', v_os.excluida_motivo),
      jsonb_build_object('excluida', false, 'motivo', NULLIF(btrim(COALESCE(p_motivo,'')),'')));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'numero', v_os.numero, 'acao', 'restaurada');
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_restaurar(uuid, text) TO authenticated;

-- 3 · marcar OS de teste da KGF com [TESTE] visível na queixa (sem apagar — decisão CEO). Reversível.
--     Mantém OS-2026-0007 (MKC5H18 · EDGE = real). Idempotente.
UPDATE public.erp_os
  SET defeito_relatado = '[TESTE] ' || COALESCE(defeito_relatado, ''), updated_at = now()
WHERE company_id = 'a462e13f-0f51-4c54-abe8-4474b591633b'
  AND numero IN ('OS-2026-0001','OS-2026-0002','OS-2026-0003','OS-2026-0004','OS-2026-0005','OS-2026-0006','OS-2026-0008','OS-2026-0009')
  AND COALESCE(defeito_relatado,'') NOT LIKE '[TESTE]%';
