-- conserto-main(revenda) · #6254 · AJUSTES Eng. Chefe
-- Problema: a tela já pergunta Sim/Não/Voltar quando há título a receber em aberto, mas o
-- backend fn_veic_venda_cancelar ainda devolve ok=false 'venda_com_titulo_aberto' SEMPRE que
-- há título aberto — então os dois caminhos (Sim e Não) falhavam no 1º passo (cancelar a venda).
--
-- Correção: a função ganha p_titulos text DEFAULT NULL ('cancelar' | 'manter'):
--   - NULL (sem escolha) + título aberto  → mantém o bloqueio atual (defesa em profundidade);
--   - 'manter'                            → cancela só a venda (deixa os títulos como estão);
--   - 'cancelar'                          → cancela a venda e, na MESMA transação, os títulos
--                                           a receber EM ABERTO, reusando fn_receber_cancelar.
-- Título PAGO/recebido nunca é tocado (o loop só pega status aberto/parcial/vencido/previsto).
-- NF-e autorizada e venda entregue continuam como bloqueio duro (inalterados).
--
-- Named-param RPC torna 3-arg e 4-arg ambíguos → DROP do 3-arg e CREATE do 4-arg (os DEFAULT
-- mantêm compat: chamadas com 3 args resolvem p_titulos = NULL = bloqueio/defesa).

DROP FUNCTION IF EXISTS public.fn_veic_venda_cancelar(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.fn_veic_venda_cancelar(
  p_venda_id uuid,
  p_user uuid,
  p_motivo text DEFAULT NULL,
  p_titulos text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_veic uuid; v_sit text; v_veic_sit text; n_titulos int; v_troca uuid;
        v_nfe_id uuid; v_nfe_num text; n_abertos int; v_rid uuid; n_tit_cancelados int := 0;
        v_escolha text := lower(NULLIF(btrim(COALESCE(p_titulos,'')),''));
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

  -- #6928 (b) · #6254: título(s) a receber em aberto. Sem escolha explícita → bloqueio (defesa).
  -- Com 'manter' segue cancelando só a venda; com 'cancelar' os títulos são cancelados depois.
  SELECT count(*) INTO n_abertos
    FROM veic_venda_recebimento vr
    JOIN erp_receber r ON r.id = vr.receber_id
   WHERE vr.venda_id = p_venda_id
     AND r.status IN ('aberto','parcial','vencido','previsto');
  IF n_abertos > 0 AND v_escolha IS DISTINCT FROM 'cancelar' AND v_escolha IS DISTINCT FROM 'manter' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'venda_com_titulo_aberto',
      'titulos_abertos', n_abertos,
      'mensagem', 'Esta venda tem ' || n_abertos || ' título(s) em aberto no financeiro. Escolha cancelar/baixar o(s) título(s) ou mantê-los antes de cancelar a venda.');
  END IF;

  SELECT count(*) INTO n_titulos FROM veic_venda_recebimento WHERE venda_id = p_venda_id AND receber_id IS NOT NULL;
  UPDATE veic_venda SET situacao = 'cancelada', observacao = COALESCE(observacao,'') || ' | CANCELADA: ' || COALESCE(p_motivo,'') WHERE id = p_venda_id;

  -- 'cancelar': na MESMA transação, cancela os títulos a receber EM ABERTO (nunca os pagos),
  -- reusando a regra única de fn_receber_cancelar (status='cancelado' + trilha em audit_log_global).
  IF v_escolha = 'cancelar' AND n_abertos > 0 THEN
    FOR v_rid IN
      SELECT r.id
        FROM veic_venda_recebimento vr
        JOIN erp_receber r ON r.id = vr.receber_id
       WHERE vr.venda_id = p_venda_id
         AND r.status IN ('aberto','parcial','vencido','previsto')
    LOOP
      PERFORM fn_receber_cancelar(v_rid, COALESCE(NULLIF(btrim(p_motivo),''), 'Venda cancelada'));
      n_tit_cancelados := n_tit_cancelados + 1;
    END LOOP;
  END IF;

  SELECT situacao INTO v_veic_sit FROM veic_veiculo WHERE id = v_veic;
  IF v_veic_sit IN ('vendido','entregue') THEN
    PERFORM fn_veic_mudar_situacao(v_veic, 'disponivel', p_user, 'Venda cancelada' || COALESCE(': '||p_motivo,''));
  END IF;
  SELECT t.veiculo_id INTO v_troca FROM veic_proposta_troca t
    JOIN veic_venda vd ON vd.proposta_id = t.proposta_id WHERE vd.id = p_venda_id AND t.veiculo_id IS NOT NULL LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'titulos_nao_excluidos', n_titulos,
    'titulos_cancelados', n_tit_cancelados, 'troca_veiculo_id', v_troca);
END $function$;

-- Guarda estrutural (check_fn_guards · revoke_anon): SECURITY DEFINER não é rota pública.
-- Reproduz a ACL viva (authenticated + service_role; sem anon/PUBLIC).
REVOKE ALL ON FUNCTION public.fn_veic_venda_cancelar(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_venda_cancelar(uuid, uuid, text, text) TO authenticated, service_role;
