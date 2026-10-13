-- OFIC-A (#10) · Pátio: "Programado" → apontar chegada → recebimento (OS). Glue mínima de backend.
--
-- Auditoria (RD-38) corrigiu 2 premissas do SPEC:
--   • fn_agendamento_mudar_status NÃO aceita 'recebido' (só agendado/confirmado/em_atendimento/
--     concluido/cancelado/nao_compareceu) → usar 'em_atendimento'.
--   • O vínculo agendamento↔OS é a coluna NATIVA erp_agendamento.os_id (não dados->>'os_id'); e
--     fn_agenda_patio_hoje já filtra os_id IS NULL → uma vez vinculado, o card some sozinho. MAS não
--     existia RPC para gravar esse os_id.
--   • A recepção (fn_oficina_recepcao_criar) JÁ cria a OS + o erp_os_recepcao juntos → o fluxo é
--     "apontar chegada = ir para o recebimento pré-preenchido", e ao criar a OS vinculamos o
--     agendamento aqui (não recriamos OS — evita OS duplicada; RD-26/RD-52).
--
-- Esta função é o único gap: vincular a OS recém-criada ao agendamento (os_id + status). Gated e
-- IDEMPOTENTE (se já vinculado, não sobrescreve — devolve a OS existente).
CREATE OR REPLACE FUNCTION public.fn_agendamento_vincular_os(p_agendamento_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_comp uuid; v_existing uuid;
BEGIN
  SELECT company_id, os_id INTO v_comp, v_existing FROM public.erp_agendamento WHERE id = p_agendamento_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'agendamento_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- idempotente: já vinculado → devolve o existente, não recria/sobrescreve
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_vinculado', true, 'os_id', v_existing); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_os WHERE id = p_os_id AND company_id = v_comp) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'os_invalida'); END IF;
  UPDATE public.erp_agendamento SET os_id = p_os_id, status = 'em_atendimento', updated_at = now()
   WHERE id = p_agendamento_id;
  RETURN jsonb_build_object('ok', true, 'ja_vinculado', false, 'os_id', p_os_id);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_agendamento_vincular_os(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agendamento_vincular_os(uuid, uuid) TO authenticated;
