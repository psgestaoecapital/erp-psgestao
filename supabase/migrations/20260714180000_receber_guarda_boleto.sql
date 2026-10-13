-- Guarda de negócio: título com BOLETO EMITIDO não se exclui — só cancelar.
-- ============================================================================
-- Cenário do CEO (produção): título "TESTE EXCLUIR" com ✓ Boleto 123 (Sicoob).
-- A lixeira do A Receber usa fn_receber_excluir, que bloqueava só pago/conciliado —
-- NÃO boleto emitido. Excluir o título deixava o boleto vivo no banco cobrando um
-- título que não existe mais. Aqui fechamos: boleto emitido (não cancelado) → bloqueia.
-- RD-51: status de boleto desconhecido/nulo com emissão = tratamos como ATIVO (bloqueia).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_receber_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_registro jsonb;
  v_status text; v_conciliado boolean; v_company_id uuid;
  v_boleto_emitido timestamptz; v_boleto_status text;
  v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(r.*), r.status, r.conciliado, r.company_id, r.boleto_emitido_em, r.boleto_status
    INTO v_registro, v_status, v_conciliado, v_company_id, v_boleto_emitido, v_boleto_status
  FROM public.erp_receber r WHERE r.id = p_id;

  IF v_registro IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado');
  END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF v_status = 'pago' OR v_conciliado THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado_ou_pago',
      'orientacao', 'Desvincule no inbox de conciliação antes de excluir.');
  END IF;
  -- 🔒 Boleto emitido (e não explicitamente cancelado) = cobrança viva no banco.
  IF v_boleto_emitido IS NOT NULL
     AND COALESCE(lower(v_boleto_status), '') NOT IN ('cancelado','cancelada','baixado','baixada','expirado','expirada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_boleto_ativo',
      'orientacao', 'Este título tem boleto emitido no banco. Cancele o boleto primeiro — senão o banco continua cobrando um título que não existe mais no sistema. Depois exclua.');
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_receber');

  PERFORM set_config('app.permitir_delete_fisico', 'on', true);
  DELETE FROM public.erp_receber WHERE id = p_id;
  PERFORM set_config('app.permitir_delete_fisico', 'off', true);

  RETURN jsonb_build_object('sucesso', true, 'id', p_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_receber_excluir(uuid) TO authenticated, service_role;
