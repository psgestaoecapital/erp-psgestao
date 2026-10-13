-- Conciliação · desvincular fatura AGRUPADA (a dor da Jordana)
--
-- Bug 1 (RD-38, Proplay): o botão "Desvincular" não faz nada em fatura agrupada. A
-- fn_conciliacao_desvincular só trata o vínculo 1:1 (p_lancamento_id); o agrupado tem
-- lancamento_id NULL e os vínculos ficam em conciliacao_vinculo -> a RPC não acha nada.
-- Além disso, fn_conciliacao_desvincular_item apaga UM vínculo mas NÃO estorna a baixa
-- que o fn_conciliacao_fechar_agrupado aplicou DIRETO no título (status='pago', valor_pago,
-- data_pagamento) — o motor de recompute (fn_recompute_baixa_titulo) só olha o 1:1, ignora
-- conciliacao_vinculo. Resultado: não há como desfazer um agrupado sem deixar o título baixado.
--
-- Esta RPC, para um movimento agrupado:
--   1. se o movimento estava 'conciliado', estorna a baixa DIRETA de cada título vinculado
--      (reduz valor_pago pelo valor_vinculado; recalcula status; limpa data_pagamento quando zera);
--   2. limpa os vínculos (conciliacao_vinculo);
--   3. reseta o movimento para 'pendente'.
-- Títulos que tiveram ajuste de juros/desconto na conciliação (o âncora do fechar_agrupado)
-- são estornados na baixa mas SINALIZADOS no retorno para conferência manual do valor/juros/desconto
-- (o valor original foi mutado por fn_conciliacao_ajustar_valores e não é restaurado aqui — sem
-- adivinhação em cima de dinheiro real). O 1:1 continua na fn_conciliacao_desvincular.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_movimento(
  p_movimento_id uuid,
  p_operador_id  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_vin        RECORD;
  v_reabertos  int := 0;
  v_com_ajuste int := 0;
  v_ajuste_ids jsonb := '[]'::jsonb;
  v_novo_pago  numeric;
  v_liq        numeric;
  v_venc       date;
  v_status     text;
BEGIN
  SELECT * INTO v_mov FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;

  -- Guard multi-tenant (Pilar 2)
  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  -- Só o caso AGRUPADO (vínculos). O 1:1 continua na fn_conciliacao_desvincular.
  IF NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_vinculos',
      'msg', 'Movimento sem vínculos agrupados. Para vínculo 1:1 use a desvinculação normal.');
  END IF;

  -- Estorna a baixa APENAS se o movimento realmente fechou (fechar_agrupado baixou os títulos).
  -- Se ainda pendente (agrupamento em construção), não toca valor_pago — só limpa os vínculos.
  IF v_mov.status = 'conciliado' THEN
    FOR v_vin IN
      SELECT cv.lancamento_tabela, cv.lancamento_id, cv.valor_vinculado,
             ( EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.id = cv.lancamento_id
                        AND (COALESCE(p.juros,0) <> 0 OR COALESCE(p.desconto,0) <> 0
                             OR p.observacoes ILIKE '%AJUSTE%' OR p.observacoes ILIKE '%VALOR AJUSTADO%'))
               OR EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = cv.lancamento_id
                        AND (COALESCE(r.juros,0) <> 0 OR COALESCE(r.desconto,0) <> 0
                             OR r.observacoes ILIKE '%AJUSTE%' OR r.observacoes ILIKE '%VALOR AJUSTADO%')) ) AS had_ajuste
      FROM public.conciliacao_vinculo cv
      WHERE cv.movimento_id = p_movimento_id
    LOOP
      IF v_vin.lancamento_tabela = 'erp_pagar' THEN
        SELECT round(GREATEST(COALESCE(valor_pago,0) - v_vin.valor_vinculado, 0), 2),
               round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2), data_vencimento
          INTO v_novo_pago, v_liq, v_venc
          FROM public.erp_pagar WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        IF v_liq IS NULL THEN CONTINUE; END IF;
        v_status := CASE WHEN v_novo_pago <= 0.01 THEN (CASE WHEN v_venc < CURRENT_DATE THEN 'vencido' ELSE 'aberto' END)
                         WHEN v_novo_pago + 0.01 >= v_liq THEN 'pago' ELSE 'parcial' END;
        UPDATE public.erp_pagar SET
          valor_pago = v_novo_pago, status = v_status,
          data_pagamento  = CASE WHEN v_novo_pago > 0.01 THEN data_pagamento  ELSE NULL END,
          forma_pagamento = CASE WHEN v_novo_pago > 0.01 THEN forma_pagamento ELSE NULL END,
          conciliado = false, movimento_banco_id = NULL, updated_at = now()
        WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
      ELSE
        SELECT round(GREATEST(COALESCE(valor_pago,0) - v_vin.valor_vinculado, 0), 2),
               round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2), data_vencimento
          INTO v_novo_pago, v_liq, v_venc
          FROM public.erp_receber WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        IF v_liq IS NULL THEN CONTINUE; END IF;
        v_status := CASE WHEN v_novo_pago <= 0.01 THEN (CASE WHEN v_venc < CURRENT_DATE THEN 'vencido' ELSE 'aberto' END)
                         WHEN v_novo_pago + 0.01 >= v_liq THEN 'pago' ELSE 'parcial' END;
        UPDATE public.erp_receber SET
          valor_pago = v_novo_pago, status = v_status,
          data_pagamento  = CASE WHEN v_novo_pago > 0.01 THEN data_pagamento  ELSE NULL END,
          forma_pagamento = CASE WHEN v_novo_pago > 0.01 THEN forma_pagamento ELSE NULL END,
          conciliado = false, movimento_banco_id = NULL, updated_at = now()
        WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
      END IF;

      v_reabertos := v_reabertos + 1;
      IF v_vin.had_ajuste THEN
        v_com_ajuste := v_com_ajuste + 1;
        v_ajuste_ids := v_ajuste_ids || to_jsonb(v_vin.lancamento_id);
      END IF;
    END LOOP;
  END IF;

  -- Limpa os vínculos
  DELETE FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id;

  -- Reseta o movimento -> pendente (grouped: lancamento_id já era NULL; o trigger de baixa é no-op)
  UPDATE public.conciliacao_movimento
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimento_id', p_movimento_id,
    'titulos_reabertos', v_reabertos,
    'titulos_com_ajuste', v_com_ajuste,
    'titulos_com_ajuste_ids', v_ajuste_ids,
    'aviso', CASE WHEN v_com_ajuste > 0
      THEN format('%s título(s) tinham ajuste de juros/desconto na conciliação: a baixa foi estornada, mas confira valor/juros/desconto manualmente.', v_com_ajuste)
      ELSE NULL END
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid, uuid) TO authenticated;
