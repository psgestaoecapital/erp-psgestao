-- RD-41 · Importador de RETORNO CNAB de pagamento — baixa automática (fecha o ciclo remessa→retorno).
-- RD-26: REUSA fn_pagar_baixar_pagamento (não recria baixa) e as colunas já existentes
--        (erp_remessa_pagamento_item.status_item/ocorrencia_retorno, erp_remessa_pagamento.retorno_importado_em).
-- RD-38 (é dinheiro): casamento é por título (item da remessa); a decisão de PAGAR é autoritativa aqui —
--        idempotente (item já 'pago' não baixa de novo), com GUARDA DE VALOR (valor do retorno tem de bater
--        com o saldo do título; divergência não baixa, vira 'pendente' pra revisão) e só baixa o que veio
--        confirmado (data + valor pago > 0). p_confirmar=false devolve a PRÉVIA sem gravar nada (mesma lógica).
--
-- Entrada p_itens: jsonb array de { item_id uuid, val_pago numeric, dt_pagamento 'YYYY-MM-DD',
--   ocorrencia text, pago_hint bool } — o parser (TS) já casou cada linha do retorno ao item por código de
--   barras; a RPC revalida contra o banco (status_item/valor) — nunca confia cegamente no que veio do cliente.

CREATE OR REPLACE FUNCTION public.fn_remessa_retorno_processar(
  p_remessa_id uuid,
  p_company_id uuid,
  p_itens jsonb,
  p_conta_bancaria_id uuid DEFAULT NULL,
  p_confirmar boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rem record;
  v_el jsonb;
  v_item record;
  v_pagar record;
  v_val_pago numeric; v_dt date; v_ocorr text; v_hint boolean;
  v_saldo numeric; v_resultado text; v_motivo text;
  v_baixa jsonb;
  v_pagos int := 0; v_rej int := 0; v_div int := 0; v_ja int := 0; v_err int := 0; v_total int := 0;
  v_detalhes jsonb := '[]'::jsonb;
  v_status_novo text;
BEGIN
  SELECT * INTO v_rem FROM erp_remessa_pagamento WHERE id = p_remessa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Remessa não encontrada.'); END IF;
  IF v_rem.company_id <> p_company_id THEN  -- multi-tenant: só a empresa dona processa (Pilar 2)
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Remessa não pertence à empresa selecionada.');
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_total := v_total + 1;
    v_val_pago := round(COALESCE((v_el->>'val_pago')::numeric, 0), 2);
    v_dt       := NULLIF(v_el->>'dt_pagamento','')::date;
    v_ocorr    := COALESCE(v_el->>'ocorrencia','');
    v_hint     := COALESCE((v_el->>'pago_hint')::boolean, false);
    v_resultado := NULL; v_motivo := NULL;

    -- item TEM de ser desta remessa (authz por remessa)
    SELECT * INTO v_item FROM erp_remessa_pagamento_item
     WHERE id = (v_el->>'item_id')::uuid AND remessa_id = p_remessa_id;
    IF NOT FOUND THEN
      v_resultado := 'nao_casado'; v_motivo := 'item não pertence a esta remessa';
      v_detalhes := v_detalhes || jsonb_build_object('item_id', v_el->>'item_id', 'resultado', v_resultado, 'motivo', v_motivo);
      CONTINUE;
    END IF;

    SELECT * INTO v_pagar FROM erp_pagar WHERE id = v_item.erp_pagar_id;

    IF v_item.status_item = 'pago' THEN
      v_ja := v_ja + 1; v_resultado := 'ja_pago'; v_motivo := 'já baixado por um retorno anterior (idempotente)';
    ELSIF NOT v_hint OR v_val_pago <= 0 OR v_dt IS NULL THEN
      v_rej := v_rej + 1; v_resultado := 'rejeitado';
      v_motivo := 'banco não confirmou pagamento (sem data/valor) · ocorrência ' || COALESCE(v_ocorr,'—');
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET status_item = 'rejeitado', ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
      END IF;
    ELSE
      v_saldo := round(COALESCE(v_pagar.valor,0) - COALESCE(v_pagar.valor_pago,0), 2);
      IF abs(v_val_pago - v_saldo) > 0.01 THEN
        v_div := v_div + 1; v_resultado := 'divergente';
        v_motivo := 'valor do retorno (R$ ' || trim(to_char(v_val_pago,'FM999999990.00')) ||
                    ') difere do saldo do título (R$ ' || trim(to_char(v_saldo,'FM999999990.00')) || ') — não baixado';
        IF p_confirmar THEN
          UPDATE erp_remessa_pagamento_item
             SET status_item = 'pendente',
                 ocorrencia_retorno = 'DIVERG val=' || trim(to_char(v_val_pago,'FM999999990.00')) ||
                                      ' saldo=' || trim(to_char(v_saldo,'FM999999990.00')) ||
                                      CASE WHEN v_ocorr <> '' THEN ' · ' || v_ocorr ELSE '' END
           WHERE id = v_item.id;
        END IF;
      ELSE
        -- pago e valor confere → baixa (só quando confirmar). Reusa a RPC de baixa (RD-26).
        IF p_confirmar THEN
          v_baixa := fn_pagar_baixar_pagamento(v_item.erp_pagar_id, v_dt, p_conta_bancaria_id, v_item.forma, v_val_pago);
          IF COALESCE((v_baixa->>'sucesso')::boolean, false) THEN
            v_pagos := v_pagos + 1; v_resultado := 'pago'; v_motivo := 'baixado';
            UPDATE erp_remessa_pagamento_item SET status_item = 'pago', ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
          ELSE
            v_err := v_err + 1; v_resultado := 'erro_baixa'; v_motivo := COALESCE(v_baixa->>'erro','falha na baixa');
            UPDATE erp_remessa_pagamento_item
               SET status_item = 'pendente', ocorrencia_retorno = 'ERRO_BAIXA: ' || v_motivo WHERE id = v_item.id;
          END IF;
        ELSE
          v_pagos := v_pagos + 1; v_resultado := 'pago'; v_motivo := 'será baixado';  -- prévia
        END IF;
      END IF;
    END IF;

    v_detalhes := v_detalhes || jsonb_build_object(
      'item_id', v_item.id, 'pagar_id', v_item.erp_pagar_id, 'resultado', v_resultado,
      'val_pago', v_val_pago, 'val_titulo', v_pagar.valor,
      'saldo', round(COALESCE(v_pagar.valor,0) - COALESCE(v_pagar.valor_pago,0), 2),
      'ocorrencia', v_ocorr, 'motivo', v_motivo);
  END LOOP;

  IF p_confirmar THEN
    -- remessa concluída se TODOS os itens estão pagos; senão, retorno parcial (reusa o enum existente · RD-26)
    SELECT CASE WHEN count(*) FILTER (WHERE status_item <> 'pago') = 0 THEN 'concluido' ELSE 'retorno_parcial' END
      INTO v_status_novo FROM erp_remessa_pagamento_item WHERE remessa_id = p_remessa_id;
    UPDATE erp_remessa_pagamento
       SET retorno_importado_em = now(), status = v_status_novo
     WHERE id = p_remessa_id;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true, 'confirmado', p_confirmar,
    'remessa_status', v_status_novo,
    'resumo', jsonb_build_object('total', v_total, 'pagos', v_pagos, 'rejeitados', v_rej,
                                 'divergentes', v_div, 'ja_pagos', v_ja, 'erros', v_err),
    'detalhes', v_detalhes);
END; $function$;

COMMENT ON FUNCTION public.fn_remessa_retorno_processar(uuid,uuid,jsonb,uuid,boolean) IS
  'Processa retorno CNAB de pagamento: casa itens da remessa, baixa os confirmados (reusa fn_pagar_baixar_pagamento), '
  'idempotente, com guarda de valor. p_confirmar=false = prévia sem gravar. RD-38/RD-26/RD-55.';
