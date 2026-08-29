-- FIX (RD-58): fn_remessa_cancelar MENTIA — reportava `titulos_liberados` mas NUNCA rodava o UPDATE que
-- libera os títulos. Resultado: toda remessa cancelada deixava os títulos presos em status
-- 'incluido_remessa' — invisíveis pra nova remessa e impossíveis de pagar (caso real: remessa 58 da KGF,
-- 12 títulos / R$ 7.598,42 travados, vencendo 01–04/09). Os dados dessa remessa já foram liberados à parte
-- (autorizado pelo CEO, com contagem pré/pós). Esta migration corrige o CÓDIGO pra não repetir.
--
-- Mesmo defeito na irmã fn_remessa_remover_item (remover 1 boleto indevido): marcava o item como removido
-- mas não devolvia o título pra 'aberto'. Corrigidas as duas. Varredura feita: 0 títulos órfãos hoje em
-- toda a base (o fix é preventivo). RD-55: liberar NÃO apaga — só devolve o título ao estado 'aberto'.

-- ── cancelar remessa: agora LIBERA de verdade os títulos não removidos ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_cancelar(p_remessa_id uuid, p_company_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_rem record; v_liberados int;
BEGIN
  SELECT * INTO v_rem FROM public.erp_remessa_pagamento WHERE id = p_remessa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT public.fn__remessa_pode(p_company_id, v_rem.company_id) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF v_rem.status = 'cancelado' THEN RETURN jsonb_build_object('sucesso', true, 'ja_cancelada', true); END IF;
  IF v_rem.retorno_importado_em IS NOT NULL OR v_rem.status IN ('retorno_parcial','concluido') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_retorno',
      'orientacao', 'Esta remessa já teve retorno do banco (pagamento processado). Não dá para cancelar — se um pagamento saiu errado, é estorno bancário.');
  END IF;

  UPDATE public.erp_remessa_pagamento
     SET status = 'cancelado', cancelada_em = now(), cancelada_por = auth.uid(), cancelamento_motivo = p_motivo
   WHERE id = p_remessa_id;

  -- LIBERA os títulos: devolve pra 'aberto' os que estão presos nesta remessa (itens não removidos).
  -- Só mexe em quem está 'incluido_remessa' (não toca em pago/agendado/parcial).
  UPDATE public.erp_pagar
     SET status = 'aberto'
   WHERE id IN (SELECT erp_pagar_id FROM public.erp_remessa_pagamento_item
                WHERE remessa_id = p_remessa_id AND removido_em IS NULL)
     AND status = 'incluido_remessa';
  GET DIAGNOSTICS v_liberados = ROW_COUNT;

  RETURN jsonb_build_object('sucesso', true, 'id', p_remessa_id, 'titulos_liberados', v_liberados);
END; $function$;

-- ── remover item: além de marcar o item removido, devolve o título pra 'aberto' se ele não estiver mais
--    em nenhuma outra remessa ativa (não cancelada) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_remover_item(p_item_id uuid, p_company_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_item record; v_rem record; v_qtd int; v_val numeric; v_liberou boolean := false;
BEGIN
  SELECT * INTO v_item FROM public.erp_remessa_pagamento_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  SELECT * INTO v_rem FROM public.erp_remessa_pagamento WHERE id = v_item.remessa_id;
  IF NOT public.fn__remessa_pode(p_company_id, v_rem.company_id) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;
  IF v_item.removido_em IS NOT NULL THEN RETURN jsonb_build_object('sucesso', true, 'ja_removido', true); END IF;
  IF v_rem.retorno_importado_em IS NOT NULL OR v_rem.status IN ('retorno_parcial','concluido','cancelado') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_retorno',
      'orientacao', 'Não dá para editar esta remessa (retorno já processado ou cancelada).');
  END IF;

  UPDATE public.erp_remessa_pagamento_item
     SET removido_em = now(), removido_por = auth.uid(), remocao_motivo = p_motivo WHERE id = p_item_id;

  SELECT count(*), COALESCE(sum(valor),0) INTO v_qtd, v_val
    FROM public.erp_remessa_pagamento_item WHERE remessa_id = v_item.remessa_id AND removido_em IS NULL;
  UPDATE public.erp_remessa_pagamento SET total_titulos = v_qtd, valor_total = v_val WHERE id = v_item.remessa_id;

  -- devolve o título pra 'aberto' se não sobrou nenhuma outra remessa ativa segurando ele
  UPDATE public.erp_pagar
     SET status = 'aberto'
   WHERE id = v_item.erp_pagar_id
     AND status = 'incluido_remessa'
     AND NOT EXISTS (
       SELECT 1 FROM public.erp_remessa_pagamento_item i2
       JOIN public.erp_remessa_pagamento r2 ON r2.id = i2.remessa_id
       WHERE i2.erp_pagar_id = v_item.erp_pagar_id AND i2.removido_em IS NULL AND r2.status <> 'cancelado');
  GET DIAGNOSTICS v_qtd = ROW_COUNT;  -- reuso: 1 se liberou o título, 0 se ficou em outra remessa
  v_liberou := (v_qtd > 0);

  SELECT count(*), COALESCE(sum(valor),0) INTO v_qtd, v_val
    FROM public.erp_remessa_pagamento_item WHERE remessa_id = v_item.remessa_id AND removido_em IS NULL;
  RETURN jsonb_build_object('sucesso', true, 'id', p_item_id, 'remessa_qtd', v_qtd, 'remessa_valor', v_val, 'titulo_liberado', v_liberou);
END; $function$;

GRANT EXECUTE ON FUNCTION public.fn_remessa_cancelar(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remessa_remover_item(uuid, uuid, text) TO authenticated;
