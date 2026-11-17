-- ============================================================
-- Chamado #6928 · Revenda · "Cancelar venda": bloquear no BACKEND
-- Code: rodrigo-code
--
-- Antes: fn_veic_venda_cancelar apenas marcava a venda como cancelada e devolvia o
-- veículo ao estoque, mesmo com NF-e autorizada e/ou título a receber em aberto —
-- deixava a nota autorizada e o título aberto, o que confunde o operador.
--
-- Agora a função RECUSA o cancelamento (erro claro) enquanto houver:
--   a) NF-e autorizada ativa vinculada à venda (veic_venda.nfe_id, ou NF-e de origem
--      'venda' apontando para a venda), status 'autorizada' e não cancelada;
--   b) título(s) a receber em aberto (erp_receber.status em aberto/parcial/vencido/previsto),
--      ligados pela veic_venda_recebimento.receber_id.
-- Só sem nota autorizada e sem título aberto o cancelamento prossegue (comportamento
-- anterior mantido: marca cancelada, devolve o veículo). Validação no BACKEND (não só UI).
-- Não altera a regra fiscal de cancelamento da nota nem a baixa de título.
-- Aditiva: só CREATE OR REPLACE da função (mesma assinatura).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_veic_venda_cancelar(p_venda_id uuid, p_user uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text; v_veic_sit text; n_titulos int; v_troca uuid;
        v_nfe_id uuid; v_nfe_num text; n_abertos int;
BEGIN
  SELECT company_id, veiculo_id, situacao, nfe_id INTO v_comp, v_veic, v_sit, v_nfe_id FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_sit = 'cancelada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'ja_cancelada'); END IF;
  -- R4a: venda entregue não se cancela — devolve-se (fecha o buraco do auditor).
  IF v_sit = 'entregue' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'venda_entregue_use_devolucao',
      'mensagem', 'Venda já entregue: registre uma DEVOLUÇÃO (com motivo), não um cancelamento.'); END IF;

  -- #6928 (a): NF-e autorizada ativa vinculada à venda → cancele a nota primeiro (tela de NF-e emitidas).
  SELECT ne.numero INTO v_nfe_num
    FROM erp_nfe_emitidas ne
   WHERE ne.status = 'autorizada' AND ne.cancelado_em IS NULL
     AND ( (v_nfe_id IS NOT NULL AND ne.id = v_nfe_id)
           OR (ne.origem_tipo = 'venda' AND ne.origem_id = p_venda_id) )
   ORDER BY ne.data_emissao DESC NULLS LAST
   LIMIT 1;
  IF v_nfe_num IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'venda_com_nfe_autorizada',
      'nfe_numero', v_nfe_num,
      'mensagem', 'Esta venda tem NF-e autorizada (nº ' || v_nfe_num || '). Cancele a nota primeiro em NF-e emitidas (Cancelar nota), dentro do prazo legal, antes de cancelar a venda.');
  END IF;

  -- #6928 (b): título(s) a receber em aberto → trate o(s) título(s) no financeiro antes.
  SELECT count(*) INTO n_abertos
    FROM veic_venda_recebimento vr
    JOIN erp_receber r ON r.id = vr.receber_id
   WHERE vr.venda_id = p_venda_id
     AND r.status IN ('aberto','parcial','vencido','previsto');
  IF n_abertos > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'venda_com_titulo_aberto',
      'titulos_abertos', n_abertos,
      'mensagem', 'Esta venda tem ' || n_abertos || ' título(s) em aberto no financeiro. Cancele/baixe o(s) título(s) antes de cancelar a venda.');
  END IF;

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

REVOKE ALL ON FUNCTION public.fn_veic_venda_cancelar(uuid, uuid, text) FROM anon;
