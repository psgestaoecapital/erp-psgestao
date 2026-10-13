-- #728 · Pedido reversível a orçamento.
-- Decisão (Rodrigo, 01/10): pedido não-faturado não se cancela direto — ele VOLTA a ser orçamento, e o
-- cancelamento vive no orçamento. Até o faturamento o pedido não tem efeito real (confirmado nos dados:
-- 0 movimentação de estoque e ~0 título efetivo em pedidos 'aberto'), então reverter é seguro.
--
-- Arquivamento do pedido = status 'revertido' (decidido): erp_pedidos não tem coluna de soft-delete e um
-- status novo resolve sem DDL de coluna nem auditoria de todas as queries; o kanban filtra 'revertido' do
-- colPed. O orçamento de origem volta a ser a entidade ativa.

-- 'revertido' é um status novo de pedido → precisa entrar no CHECK chk_pedidos_status (senão o UPDATE abaixo
-- viola a constraint). Recria o CHECK preservando os valores atuais + 'revertido'.
ALTER TABLE public.erp_pedidos DROP CONSTRAINT IF EXISTS chk_pedidos_status;
ALTER TABLE public.erp_pedidos ADD CONSTRAINT chk_pedidos_status
  CHECK (status = ANY (ARRAY[
    'aberto','em_separacao','expedido','entregue',
    'faturamento_parcial','faturado','cancelado_parcial','cancelado','revertido'
  ]));

CREATE OR REPLACE FUNCTION public.fn_pedido_reverter_para_orcamento(p_pedido_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ped record; v_orc record; v_del int := 0;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_ped FROM public.erp_pedidos WHERE id = p_pedido_id;
  IF v_ped IS NULL THEN RAISE EXCEPTION 'Pedido nao encontrado'; END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_ped.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  -- Só reverte pedido ABERTO. Faturado / faturamento_parcial têm efeito real (NF, estoque, título efetivo);
  -- cancelado / revertido já saíram do fluxo.
  IF v_ped.status <> 'aberto' THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      CASE v_ped.status
        WHEN 'faturado'            THEN 'Pedido faturado não volta a orçamento (NF/estoque/título já efetivados).'
        WHEN 'faturamento_parcial' THEN 'Pedido com faturamento parcial não volta a orçamento.'
        WHEN 'cancelado'           THEN 'Pedido cancelado.'
        WHEN 'revertido'           THEN 'Pedido já revertido para orçamento.'
        ELSE 'Só pedido em aberto volta a orçamento (status atual: ' || v_ped.status || ').'
      END);
  END IF;

  IF v_ped.orcamento_origem_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Pedido sem orçamento de origem — não há para onde reverter.');
  END IF;

  -- Soft-delete das previsões do pedido (mesma limpeza de 'previsto' que o fn_pedido_gerar_previsao usa).
  UPDATE public.erp_receber
     SET deleted_at = now(), updated_at = now()
   WHERE pedido_id = p_pedido_id AND status = 'previsto' AND deleted_at IS NULL;
  GET DIAGNOSTICS v_del = ROW_COUNT;

  -- Reativa o orçamento de origem. CRÍTICO zerar pedido_id: fn_converter_orcamento_em_pedido trava com
  -- 'Orcamento ja foi convertido em pedido %' se pedido_id IS NOT NULL — sem zerar, não dá pra re-converter.
  SELECT * INTO v_orc FROM public.erp_orcamentos WHERE id = v_ped.orcamento_origem_id;
  IF v_orc.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento de origem não encontrado.');
  END IF;

  UPDATE public.erp_orcamentos
     SET status = 'aprovado', pedido_id = NULL, convertido_em = NULL, updated_at = now()
   WHERE id = v_ped.orcamento_origem_id;

  INSERT INTO public.erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id, metadata)
  VALUES (v_ped.orcamento_origem_id, v_ped.company_id, 'revertido_de_pedido',
    'Pedido ' || COALESCE(v_ped.numero,'') || ' revertido para orçamento', auth.uid(),
    jsonb_build_object('pedido_id', p_pedido_id, 'previstos_removidos', v_del));

  -- Arquiva o pedido (o kanban filtra 'revertido' do colPed/colFat).
  UPDATE public.erp_pedidos SET status = 'revertido', updated_at = now() WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true, 'pedido_id', p_pedido_id,
    'orcamento_id', v_ped.orcamento_origem_id, 'previstos_removidos', v_del);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pedido_reverter_para_orcamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pedido_reverter_para_orcamento(uuid) TO authenticated, service_role;
