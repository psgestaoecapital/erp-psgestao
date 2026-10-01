-- #728 (R.R · CEO aprovou 01/10): cancelar orçamento e pedido na tela Vender e Faturar.
-- Já existia fn_pedido_cancelar (motivo obrigatório, cancelava parcelas previstas), mas NENHUMA tela a chamava e ela só
-- estava liberada para service_role. Agora, para pedido e orçamento:
--  • motivo obrigatório: um motivo da lista da empresa OU um texto (a R.R não tem lista — o texto basta);
--  • pedido com NF-e/NFS-e autorizada (ou processando) → recusa e diz qual nota cancelar antes;
--  • parcela já paga (total ou parcial) → recusa: faça a devolução/estorno antes;
--  • parcela com boleto registrado e não pago → recusa: baixe/cancele o boleto no banco antes;
--  • parcelas previstas/em aberto sem boleto → canceladas, com o motivo;
--  • estoque: o pedido não reserva estoque hoje (a reserva existe só para OS); o estoque sai no "Faturar". Pedido
--    já faturado é RECUSADO (não existe estorno de faturamento — cancelar deixaria o estoque baixado sem volta);
--  • nada é apagado (RD-30): histórico do pedido/orçamento com quem, quando e por quê.

CREATE OR REPLACE FUNCTION public.fn__otc_motivo_cancelamento(p_company_id uuid, p_motivo_perda_id uuid, p_motivo_texto text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_nome text; v_exige boolean; v_txt text := NULLIF(btrim(COALESCE(p_motivo_texto, '')), '');
BEGIN
  IF p_motivo_perda_id IS NOT NULL THEN
    SELECT nome, exige_descricao INTO v_nome, v_exige FROM erp_motivo_perda
     WHERE id = p_motivo_perda_id AND company_id = p_company_id AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Motivo inválido para esta empresa.'; END IF;
    IF v_exige AND v_txt IS NULL THEN RAISE EXCEPTION 'Este motivo exige uma descrição — diga o que aconteceu.'; END IF;
    RETURN concat_ws(' — ', v_nome, v_txt);
  END IF;
  IF v_txt IS NULL OR length(v_txt) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (escolha um motivo ou descreva em poucas palavras).';
  END IF;
  RETURN v_txt;
END $function$;
REVOKE ALL ON FUNCTION public.fn__otc_motivo_cancelamento(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__otc_motivo_cancelamento(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_pedido_cancelar(p_pedido_id uuid, p_motivo_perda_id uuid, p_motivo_texto text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ped record; v_motivo text; v_notas text; v_boletos text; v_pagas text; v_n int := 0;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_ped FROM erp_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(v_ped.company_id);
  IF v_ped.status IN ('cancelado', 'cancelado_parcial') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Este pedido já está cancelado.');
  END IF;

  -- 0) pedido já faturado: o "Faturar" baixou o estoque e gerou os títulos; não existe estorno de faturamento —
  --    cancelar aqui deixaria o estoque baixado sem volta. Recusa com o motivo (decisão a levar ao CEO).
  IF v_ped.status IN ('faturado', 'faturamento_parcial') THEN
    RAISE EXCEPTION 'Este pedido já foi faturado: o estoque já saiu e os títulos foram gerados. O cancelamento de pedido faturado ainda não existe — fale com o suporte PS.';
  END IF;

  v_motivo := public.fn__otc_motivo_cancelamento(v_ped.company_id, p_motivo_perda_id, p_motivo_texto);

  -- 1) nota fiscal emitida: cancelar a nota antes (a nota é documento fiscal; cancelar o pedido não a desfaz)
  SELECT string_agg(n, ', ') INTO v_notas FROM (
    SELECT 'NFS-e nº ' || COALESCE(numero, '(em processamento)') n FROM erp_nfse_emitidas
     WHERE pedido_id = p_pedido_id AND status IN ('autorizada', 'processando')
    UNION ALL
    SELECT 'NF-e nº ' || COALESCE(numero, '(em processamento)') FROM erp_nfe_emitidas
     WHERE pedido_id = p_pedido_id AND status = 'autorizada'
  ) x;
  IF v_notas IS NOT NULL THEN
    RAISE EXCEPTION 'Este pedido tem nota fiscal emitida (%). Cancele a nota antes (Fiscal › Notas emitidas) e depois cancele o pedido.', v_notas;
  END IF;

  -- 2) parcela já recebida: devolução/estorno antes
  SELECT string_agg(COALESCE(descricao, 'parcela') || ' (R$ ' || to_char(COALESCE(valor, 0), 'FM999G999G990D00') || ')', ', ')
    INTO v_pagas FROM erp_receber
   WHERE pedido_id = p_pedido_id AND deleted_at IS NULL AND status IN ('pago', 'parcial');
  IF v_pagas IS NOT NULL THEN
    RAISE EXCEPTION 'Este pedido já tem recebimento (%). Faça a devolução ou o estorno antes de cancelar.', v_pagas;
  END IF;

  -- 3) boleto registrado no banco e não pago: baixar/cancelar no banco antes
  SELECT string_agg('nosso número ' || COALESCE(boleto_nosso_numero, '?'), ', ') INTO v_boletos FROM erp_receber
   WHERE pedido_id = p_pedido_id AND deleted_at IS NULL AND status IN ('aberto', 'vencido')
     AND boleto_status = 'registrado' AND boleto_pago_em IS NULL;
  IF v_boletos IS NOT NULL THEN
    RAISE EXCEPTION 'Há boleto registrado no banco para este pedido (%). Baixe ou cancele o boleto no banco antes de cancelar o pedido.', v_boletos;
  END IF;

  -- 4) parcelas previstas/em aberto: canceladas com o motivo (nada é apagado)
  UPDATE erp_receber
     SET status = 'cancelado', motivo_perda_id = p_motivo_perda_id, motivo_perda = v_motivo,
         cancelado_em = now(), updated_at = now()
   WHERE pedido_id = p_pedido_id AND deleted_at IS NULL AND status IN ('previsto', 'aberto', 'vencido');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE erp_pedidos SET status = 'cancelado', updated_at = now() WHERE id = p_pedido_id;

  INSERT INTO erp_pedido_historico (pedido_id, company_id, evento, detalhe, usuario_id, usuario_nome, metadata)
  VALUES (p_pedido_id, v_ped.company_id, 'cancelado', v_motivo, v_uid,
          (SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM users WHERE id = v_uid),
          jsonb_build_object('status_anterior', v_ped.status, 'parcelas_canceladas', v_n, 'motivo_perda_id', p_motivo_perda_id));

  RETURN jsonb_build_object('ok', true, 'pedido_id', p_pedido_id, 'status', 'cancelado', 'parcelas_canceladas', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pedido_cancelar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_cancelar(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_orcamento_cancelar(p_orcamento_id uuid, p_motivo_perda_id uuid, p_motivo_texto text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_orc record; v_motivo text; v_ped_num text; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_orc FROM erp_orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(v_orc.company_id);
  IF v_orc.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Este orçamento já está cancelado.');
  END IF;
  IF v_orc.status IN ('convertido', 'venda_avulsa') THEN
    SELECT numero INTO v_ped_num FROM erp_pedidos WHERE id = v_orc.pedido_id;
    RAISE EXCEPTION 'Este orçamento já virou o pedido %. Cancele o pedido.', COALESCE(v_ped_num, '(sem número)');
  END IF;

  v_motivo := public.fn__otc_motivo_cancelamento(v_orc.company_id, p_motivo_perda_id, p_motivo_texto);

  UPDATE erp_orcamentos SET status = 'cancelado', updated_at = now() WHERE id = p_orcamento_id;

  INSERT INTO erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id, usuario_nome, metadata)
  VALUES (p_orcamento_id, v_orc.company_id, 'cancelado', v_motivo, v_uid,
          (SELECT COALESCE(NULLIF(btrim(full_name), ''), email) FROM users WHERE id = v_uid),
          jsonb_build_object('status_anterior', v_orc.status, 'motivo_perda_id', p_motivo_perda_id));

  RETURN jsonb_build_object('ok', true, 'orcamento_id', p_orcamento_id, 'status', 'cancelado');
END $function$;
REVOKE ALL ON FUNCTION public.fn_orcamento_cancelar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_cancelar(uuid, uuid, text) TO authenticated, service_role;
