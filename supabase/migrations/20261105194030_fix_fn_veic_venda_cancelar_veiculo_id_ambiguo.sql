-- Chamado Alliance (rodrigo-code, 05/11): Cancelar venda falhava com
-- 'column reference "veiculo_id" is ambiguous' (veic_proposta_troca x veic_venda).
-- Correção mínima: qualificar t.veiculo_id. Mesmo contrato de retorno; nada mais muda.
CREATE OR REPLACE FUNCTION public.fn_veic_venda_cancelar(p_venda_id uuid, p_user uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text; v_veic_sit text; n_titulos int; v_troca uuid;
BEGIN
  SELECT company_id, veiculo_id, situacao INTO v_comp, v_veic, v_sit FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_cancelada'); END IF;
  -- R4a: venda entregue não se cancela — devolve-se (fecha o buraco do auditor).
  IF v_sit = 'entregue' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'venda_entregue_use_devolucao',
      'mensagem', 'Venda já entregue: registre uma DEVOLUÇÃO (com motivo), não um cancelamento.'); END IF;

  SELECT count(*) INTO n_titulos FROM veic_venda_recebimento WHERE venda_id = p_venda_id AND receber_id IS NOT NULL;
  UPDATE veic_venda SET situacao = 'cancelada', observacao = COALESCE(observacao,'') || ' | CANCELADA: ' || COALESCE(p_motivo,'') WHERE id = p_venda_id;

  SELECT situacao INTO v_veic_sit FROM veic_veiculo WHERE id = v_veic;
  IF v_veic_sit IN ('vendido','entregue') THEN
    PERFORM fn_veic_mudar_situacao(v_veic, 'disponivel', p_user, 'Venda cancelada' || COALESCE(': '||p_motivo,''));
  END IF;
  SELECT t.veiculo_id INTO v_troca FROM veic_proposta_troca t
    JOIN veic_venda vd ON vd.proposta_id = t.proposta_id WHERE vd.id = p_venda_id AND t.veiculo_id IS NOT NULL LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'titulos_nao_excluidos', n_titulos, 'troca_veiculo_id', v_troca);
END $function$;
