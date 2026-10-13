-- =============================================================
-- fiscal-cancelamento-nfe-v1 · fn_cancelar_nfe
-- =============================================================
-- Grava o cancelamento de uma NFe apos a SEFAZ aceitar via Focus.
-- A chamada HTTP eh feita ANTES via route /api/fiscal/nfe/cancelar
-- (usa svc.cancelarNFe -> FocusNFeProvider.cancelarNFe).
--
-- Validacoes:
--   - nfe_id obrigatorio
--   - justificativa >= 15 caracteres (regra SEFAZ)
--   - status atual = 'autorizada'
--   - prazo legal 24h pos data_emissao (SEFAZ-SC default)
--     TODO PARAMETRO_CONFIRMAR_COM_CONTADOR: validar prazo p/ regime
--
-- Pilar 1 (atencao): em caso de prazo expirado, frontend ja recebe
-- mensagem orientando a usar carta de correcao ou nota de ajuste.
--
-- Aplicada via MCP em 2026-06-15.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_cancelar_nfe(
  p_nfe_id uuid,
  p_justificativa text,
  p_operador_id uuid,
  p_provider_raw jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  IF v_nfe.status <> 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'NFe nao esta autorizada (status atual: '||v_nfe.status||')');
  END IF;

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

GRANT EXECUTE ON FUNCTION public.fn_cancelar_nfe(uuid, text, uuid, jsonb) TO authenticated;
