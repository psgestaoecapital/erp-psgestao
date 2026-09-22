-- Saneamento lote 3 (fiscal) · fechar IDOR em RPCs SECURITY DEFINER que MUTAM por id sem guarda de empresa.
--
-- Mesmo padrão do fn_faturar (#1676): estas três eram SECURITY DEFINER, com EXECUTE para anon e SEM guarda
-- de empresa — qualquer um com a anon key e um id de nota faturava/cancelava/estornava documento de
-- QUALQUER empresa (a guarda existia só na rota /api, que uma chamada RPC direta ignora). Auditoria:
--   fn_cancelar_nfe(p_nfe_id,...)                      → UPDATE erp_nfe_emitidas SET status='cancelada'
--   fn_emitir_carta_correcao(p_nfe_id,...)             → INSERT erp_nfe_eventos (CC-e)
--   fn_nfe_devolucao_estornar_estoque(p_company_id,...) → movimenta estoque
-- Correção: guarda de empresa no início (sessão precisa ter vínculo com a empresa do documento, ou ser
-- admin; service_role/interno passa) + REVOKE de PUBLIC/anon. Corpo INALTERADO fora a guarda.

-- ── fn_cancelar_nfe ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cancelar_nfe(p_nfe_id uuid, p_justificativa text, p_operador_id uuid, p_provider_raw jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_nfe RECORD;
  v_prazo_horas int := 24;
BEGIN
  IF p_nfe_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nfe_id obrigatorio');
  END IF;
  IF p_justificativa IS NULL OR length(btrim(p_justificativa)) < 15 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Justificativa exige minimo 15 caracteres (regra SEFAZ)');
  END IF;

  SELECT * INTO v_nfe FROM erp_nfe_emitidas WHERE id = p_nfe_id;
  IF v_nfe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFe nao encontrada');
  END IF;

  -- SEGURANÇA (IDOR): a sessão precisa ter vínculo com a empresa da nota (ou ser admin). service_role passa.
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND v_nfe.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_nfe.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFe nao esta autorizada (status atual: '||v_nfe.status||')');
  END IF;

  -- Prazo legal: usa data_emissao como referencia (autorizada_em nao existe)
  -- TODO PARAMETRO_CONFIRMAR_COM_CONTADOR: SEFAZ-SC default 24h
  IF v_nfe.data_emissao IS NOT NULL
     AND v_nfe.data_emissao < now() - (v_prazo_horas || ' hours')::interval THEN
    RETURN jsonb_build_object(
      'ok', false,
      'erro', format('Prazo legal de %s horas para cancelamento expirado · use carta de correcao ou nota de ajuste', v_prazo_horas)
    );
  END IF;

  UPDATE erp_nfe_emitidas
  SET status = 'cancelada',
      cancelado_em = now(),
      cancelado_por = p_operador_id,
      justificativa_cancelamento = btrim(p_justificativa),
      provider_raw = COALESCE(p_provider_raw, provider_raw),
      atualizado_em = now()
  WHERE id = p_nfe_id;

  RETURN jsonb_build_object(
    'ok', true,
    'nfe_id', p_nfe_id,
    'status', 'cancelada',
    'cancelado_em', now()
  );
END;
$function$;

-- ── fn_emitir_carta_correcao ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_emitir_carta_correcao(p_nfe_id uuid, p_correcao text, p_operador_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_nfe RECORD;
  v_correcao text;
  v_sequencia int;
  v_evento_id uuid;
BEGIN
  IF p_nfe_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nfe_id obrigatorio');
  END IF;
  v_correcao := btrim(COALESCE(p_correcao, ''));
  IF length(v_correcao) < 15 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Correcao exige minimo 15 caracteres (regra SEFAZ)');
  END IF;
  IF length(v_correcao) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Correcao excede 1000 caracteres (regra SEFAZ)');
  END IF;

  SELECT * INTO v_nfe FROM erp_nfe_emitidas WHERE id = p_nfe_id;
  IF v_nfe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFe nao encontrada');
  END IF;

  -- SEGURANÇA (IDOR): igual ao fn_cancelar_nfe — vínculo com a empresa da nota (ou admin); service_role passa.
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND v_nfe.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_nfe.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFe nao esta autorizada (status atual: '||v_nfe.status||')');
  END IF;

  -- proxima sequencia: max(sequencia) + 1, default 1, limite legal 20
  SELECT COALESCE(MAX(sequencia), 0) + 1 INTO v_sequencia
  FROM erp_nfe_eventos
  WHERE nfe_id = p_nfe_id AND tipo = 'carta_correcao'
    AND status IN ('processando','registrado');

  IF v_sequencia > 20 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Limite legal de 20 CC-e por NFe atingido');
  END IF;

  INSERT INTO erp_nfe_eventos (
    nfe_id, company_id, tipo, sequencia, correcao,
    status, criado_por
  ) VALUES (
    p_nfe_id, v_nfe.company_id, 'carta_correcao', v_sequencia, v_correcao,
    'processando', p_operador_id
  ) RETURNING id INTO v_evento_id;

  RETURN jsonb_build_object(
    'ok', true,
    'evento_id', v_evento_id,
    'sequencia', v_sequencia,
    'status', 'processando'
  );
END;
$function$;

-- ── fn_nfe_devolucao_estornar_estoque ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfe_devolucao_estornar_estoque(p_company_id uuid, p_nfe_emitida_id uuid, p_itens jsonb, p_direcao text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tipo text; v_local uuid; v_numero text; v_item jsonb; v_movidos int := 0; v_mov uuid;
BEGIN
  -- SEGURANÇA (IDOR): guarda na empresa do parâmetro (a função movimenta estoque desta empresa).
  IF auth.role() <> 'service_role' AND NOT public.is_admin()
     AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  v_tipo := CASE p_direcao WHEN 'compra' THEN 'devolucao_saida'
                           WHEN 'venda'  THEN 'devolucao_entrada' END;
  IF v_tipo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'direcao_invalida'); END IF;

  IF EXISTS (SELECT 1 FROM erp_estoque_movimentacoes
             WHERE company_id = p_company_id AND ref_tipo = 'nfe_devolucao' AND ref_id = p_nfe_emitida_id) THEN
    RETURN jsonb_build_object('ok', true, 'ja_estornado', true, 'movidos', 0);
  END IF;

  SELECT id INTO v_local FROM erp_estoque_locais WHERE company_id = p_company_id ORDER BY id LIMIT 1;
  IF v_local IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_local_estoque'); END IF;

  SELECT numero INTO v_numero FROM erp_nfe_emitidas WHERE id = p_nfe_emitida_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF (v_item->>'produto_id') IS NULL OR (v_item->>'quantidade') IS NULL THEN CONTINUE; END IF;
    v_mov := fn_movimentar_estoque(
      (v_item->>'produto_id')::uuid, v_local, v_tipo, (v_item->>'quantidade')::numeric,
      COALESCE((v_item->>'custo')::numeric, 0),
      'Devolução de ' || p_direcao, 'NF de devolução ' || COALESCE(v_numero, ''),
      'nfe_devolucao', p_nfe_emitida_id, v_numero);
    v_movidos := v_movidos + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ja_estornado', false, 'movidos', v_movidos, 'tipo', v_tipo);
END $function$;

-- Saneamento: nascem fechadas (REVOKE PUBLIC/anon; GRANT authenticated/service_role).
REVOKE ALL ON FUNCTION public.fn_cancelar_nfe(uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_nfe(uuid, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_nfe(uuid, text, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_emitir_carta_correcao(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_emitir_carta_correcao(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_emitir_carta_correcao(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_nfe_devolucao_estornar_estoque(uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_nfe_devolucao_estornar_estoque(uuid, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_devolucao_estornar_estoque(uuid, uuid, jsonb, text) TO authenticated, service_role;
