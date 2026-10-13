-- ============================================================
-- CRUD completo da OS — EXCLUIR (soft-delete) + CANCELAR (guarda fiscal).
--
-- Pilar 1 (nunca perder dado fiscal):
--   • SOFT DELETE: nunca apaga a linha — marca excluida=true.
--   • GUARDA CRÍTICA: OS já faturada (titulos_gerados OU lancamento_id) NÃO
--     se exclui → CANCELA (status='cancelada' + motivo). Reusa o status que
--     já existe; não abre buraco contábil.
--   • GUARDA DE TENANT: só a empresa dona (company_id IN user_company_ids()).
--   • TRILHA: quem/quando em audit_log_global (acao EXCLUIU / CANCELOU).
--
-- Aditivo: colunas nullable, não quebra nada existente.
-- ============================================================

-- 1) Colunas de soft-delete / cancelamento -------------------
ALTER TABLE erp_os
  ADD COLUMN IF NOT EXISTS excluida         boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluida_em      timestamptz,
  ADD COLUMN IF NOT EXISTS excluida_por     uuid,
  ADD COLUMN IF NOT EXISTS excluida_motivo  text,
  ADD COLUMN IF NOT EXISTS cancelada_em     timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_por    uuid,
  ADD COLUMN IF NOT EXISTS cancelada_motivo text;

-- Índice parcial: as listagens sempre filtram "não excluída".
CREATE INDEX IF NOT EXISTS idx_erp_os_vivas
  ON erp_os (company_id, status)
  WHERE excluida = false;

-- 2) fn_os_excluir — decide sozinha entre EXCLUIR e CANCELAR ---
CREATE OR REPLACE FUNCTION public.fn_os_excluir(p_os_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os        erp_os%ROWTYPE;
  v_faturada  boolean;
  v_acao      text;
  v_motivo    text := NULLIF(btrim(COALESCE(p_motivo,'')), '');
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada');
  END IF;

  -- GUARDA DE TENANT: só a empresa dona.
  IF v_os.company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;

  -- Idempotência: já saiu de cena.
  IF v_os.excluida THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'excluida', 'numero', v_os.numero, 'ja_estava', true);
  END IF;
  IF v_os.status = 'cancelada' THEN
    RETURN jsonb_build_object('ok', true, 'acao', 'cancelada', 'numero', v_os.numero, 'ja_estava', true);
  END IF;

  -- GUARDA FISCAL: tem título/lançamento? Então NÃO exclui — cancela.
  v_faturada := COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL;

  IF v_faturada THEN
    IF v_motivo IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'faturada', true,
        'erro', 'OS faturada exige motivo para cancelar');
    END IF;
    v_acao := 'cancelada';
    UPDATE erp_os SET
      status           = 'cancelada',
      cancelada_em     = now(),
      cancelada_por    = auth.uid(),
      cancelada_motivo = v_motivo,
      updated_at       = now()
    WHERE id = p_os_id;
  ELSE
    v_acao := 'excluida';
    UPDATE erp_os SET
      excluida        = true,
      excluida_em     = now(),
      excluida_por    = auth.uid(),
      excluida_motivo = v_motivo,
      updated_at      = now()
    WHERE id = p_os_id;
  END IF;

  -- TRILHA DE AUDITORIA (best-effort: nunca derruba a operação).
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (
      v_os.company_id, auth.uid(),
      (SELECT email FROM users WHERE id = auth.uid()),
      'erp_os', v_os.id::text,
      CASE WHEN v_acao='cancelada' THEN 'CANCELOU' ELSE 'EXCLUIU' END,
      jsonb_build_object('numero', v_os.numero, 'status', v_os.status,
                         'total', v_os.total, 'titulos_gerados', v_os.titulos_gerados),
      jsonb_build_object('acao', v_acao, 'motivo', v_motivo)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'acao', v_acao, 'numero', v_os.numero, 'faturada', v_faturada);
END; $function$;

-- 3) fn_os_salvar — passa a editar TODOS os campos (placa/modelo/cliente/
--    prioridade) + guarda de tenant. Mantém recálculo de total.
CREATE OR REPLACE FUNCTION public.fn_os_salvar(p_os_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os erp_os%ROWTYPE; v_novo_status text := p_dados->>'status';
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada'); END IF;

  -- GUARDA DE TENANT.
  IF v_os.company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;

  IF v_novo_status IS NOT NULL AND v_novo_status NOT IN
    ('aberta','em_execucao','aguardando_peca','aguardando_aprovacao','pronta','entregue','cancelada')
  THEN RETURN jsonb_build_object('ok', false, 'erro', 'Status invalido'); END IF;

  UPDATE erp_os SET
    -- veículo estruturado
    placa=COALESCE(NULLIF(upper(regexp_replace(COALESCE(p_dados->>'placa',''), '[^A-Za-z0-9]', '', 'g')),''), placa),
    modelo=COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    marca=COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    ano=COALESCE(NULLIF(p_dados->>'ano','')::int, ano),
    km=COALESCE(NULLIF(p_dados->>'km','')::int, km),
    chassi=COALESCE(NULLIF(btrim(p_dados->>'chassi'),''), chassi),
    -- cliente
    cliente_nome=COALESCE(NULLIF(btrim(p_dados->>'cliente_nome'),''), cliente_nome),
    cliente_cnpj=COALESCE(NULLIF(btrim(p_dados->>'cliente_cnpj'),''), cliente_cnpj),
    -- serviço
    equipamento=COALESCE(p_dados->>'equipamento',equipamento),
    defeito_relatado=COALESCE(p_dados->>'defeito_relatado',defeito_relatado),
    descricao_servico=COALESCE(p_dados->>'descricao_servico',descricao_servico),
    endereco_servico=COALESCE(p_dados->>'endereco_servico',endereco_servico),
    observacoes_cliente=COALESCE(p_dados->>'observacoes_cliente',observacoes_cliente),
    observacoes_internas=COALESCE(p_dados->>'observacoes_internas',observacoes_internas),
    prioridade=COALESCE(NULLIF(p_dados->>'prioridade',''), prioridade),
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

  -- RECALCULO DO TOTAL: mao de obra + pecas/produtos + deslocamento - desconto
  UPDATE erp_os SET total =
      (COALESCE(valor_hora,0) * COALESCE(NULLIF(horas_executadas,0), horas_previstas, 0))
    + COALESCE(valor_servico,0) + COALESCE(valor_materiais,0)
    + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0)
  WHERE id=p_os_id RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok',true,'os_id',v_os.id,'status',v_os.status,'total',v_os.total);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_excluir(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_os_salvar(uuid, jsonb)  TO authenticated;
