-- RD-41 · Importar retorno: AUTO-MATCH por título, sem escolher remessa (evolução do #983).
-- O .RET pode trazer pagamentos de VÁRIAS remessas. Esta RPC casa cada pagamento direto com o título,
-- por identificador (código de barras / chave PIX / documento), atravessando todas as remessas ativas da
-- empresa — nunca pelo número do arquivo, nunca exigindo seleção de remessa.
--
-- Casamento: boleto casa pelo CÓDIGO DE BARRAS (único → chave forte, casa sozinho, como no #983);
-- PIX/documento exigem também o valor do título (chave/documento podem repetir por fornecedor).
--
-- Idempotência ancorada no TÍTULO (erp_pagar.status='pago') e no item ('pago', mesmo estado terminal do
-- #983 — 'baixado' não é valor válido do check de status_item) → reimportar o mesmo .RET classifica como
-- 'ja_pago' e NÃO baixa de novo, qualquer que tenha sido o caminho da baixa.
-- Segurança RD-38: só baixa pagamento CONFIRMADO pelo banco (com data + valor pago > 0); linha de
-- rejeição (sem data/valor) casa o título mas NÃO baixa — vira 'rejeitado' pra tratar à mão.
CREATE OR REPLACE FUNCTION public.fn_remessa_retorno_conciliar_auto(
  p_company_id uuid, p_itens jsonb, p_confirmar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_el jsonb;
  v_item RECORD;
  v_barra text; v_chave text; v_doc text;
  v_val_tit numeric; v_val_pago numeric; v_dt date; v_ocorr text; v_hint boolean;
  v_resultado text; v_motivo text; v_baixa jsonb;
  v_matched uuid[] := '{}';               -- itens já casados nesta execução
  v_casados jsonb := '[]'::jsonb;         -- vão baixar (ou baixaram)
  v_naocasados jsonb := '[]'::jsonb;      -- nenhum título correspondente
  v_rejeitados jsonb := '[]'::jsonb;      -- banco não confirmou o pagamento
  v_japagos jsonb := '[]'::jsonb;         -- título/ item já baixado (idempotente)
  v_total int := 0; v_pagos int := 0; v_rej int := 0; v_ja int := 0; v_err int := 0; v_nc int := 0;
BEGIN
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_total := v_total + 1;
    v_barra    := regexp_replace(COALESCE(v_el->>'codigo_barras',''), '\D', '', 'g');
    v_chave    := NULLIF(v_el->>'chave_pix','');
    v_doc      := NULLIF(v_el->>'documento','');
    v_val_tit  := round(COALESCE((v_el->>'valor')::numeric, 0), 2);        -- valor de face do título (casamento pix/doc)
    v_val_pago := round(COALESCE((v_el->>'valor_pago')::numeric, 0), 2);   -- valor efetivamente pago (confirmação)
    v_dt       := NULLIF(v_el->>'data_pagamento','')::date;
    v_ocorr    := COALESCE(v_el->>'ocorrencia','');
    v_hint     := COALESCE((v_el->>'pago_hint')::boolean, (v_dt IS NOT NULL AND v_val_pago > 0));

    -- casa com um título de QUALQUER remessa não-cancelada da empresa. Boleto: barra sozinha (única).
    -- PIX/documento: identificador + valor. Prefere item aberto (não baixado) e remessa mais recente.
    SELECT i.id AS item_id, i.remessa_id, i.erp_pagar_id, i.valor AS item_valor, i.status_item,
           r.numero_sequencial, p.descricao, p.status AS pstatus
      INTO v_item
    FROM erp_remessa_pagamento_item i
    JOIN erp_remessa_pagamento r ON r.id = i.remessa_id AND r.company_id = p_company_id AND r.status <> 'cancelado'
    JOIN erp_pagar p ON p.id = i.erp_pagar_id
    WHERE i.removido_em IS NULL
      AND NOT (i.id = ANY(v_matched))
      AND (
            (v_barra <> '' AND regexp_replace(COALESCE(p.codigo_barras,''), '\D','','g') = v_barra)
         OR (v_chave IS NOT NULL AND COALESCE(i.chave_pix, p.chave_pix) = v_chave AND round(i.valor,2) = v_val_tit)
         OR (v_doc   IS NOT NULL AND p.numero_documento = v_doc AND round(i.valor,2) = v_val_tit)
      )
    ORDER BY (CASE WHEN i.status_item <> 'pago' AND p.status <> 'pago' THEN 0 ELSE 1 END),
             r.numero_sequencial DESC
    LIMIT 1;

    IF NOT FOUND THEN
      v_nc := v_nc + 1;
      v_naocasados := v_naocasados || jsonb_build_object(
        'valor', v_val_tit, 'valor_pago', v_val_pago, 'codigo_barras', NULLIF(v_barra,''),
        'chave_pix', v_chave, 'ocorrencia', v_ocorr, 'motivo', 'não encontrei título correspondente');
      CONTINUE;
    END IF;

    v_matched := v_matched || v_item.item_id;

    IF v_item.status_item = 'pago' OR v_item.pstatus = 'pago' THEN
      -- idempotente: já baixado (por este fluxo ou por qualquer outro) → não baixa de novo
      v_ja := v_ja + 1;
      v_japagos := v_japagos || jsonb_build_object('item_id', v_item.item_id, 'remessa', v_item.numero_sequencial,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'motivo', 'título já baixado');
    ELSIF NOT v_hint OR v_val_pago <= 0 OR v_dt IS NULL THEN
      -- banco não confirmou pagamento (sem data/valor) → casa o título mas NÃO baixa
      v_rej := v_rej + 1;
      v_rejeitados := v_rejeitados || jsonb_build_object('item_id', v_item.item_id, 'remessa', v_item.numero_sequencial,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'ocorrencia', v_ocorr,
        'motivo', 'banco não confirmou pagamento (sem data/valor) · ocorrência ' || COALESCE(NULLIF(v_ocorr,''),'—'));
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET status_item='rejeitado', ocorrencia_retorno=v_ocorr WHERE id=v_item.item_id;
      END IF;
    ELSE
      -- pagamento confirmado → baixa o título (mesma baixa canônica do resto · RD-52) e marca o item
      v_resultado := 'pago'; v_motivo := 'será baixado';
      IF p_confirmar THEN
        v_baixa := fn_pagar_baixar_pagamento(v_item.erp_pagar_id, v_dt, NULL, 'cnab', v_item.item_valor);
        IF COALESCE((v_baixa->>'sucesso')::boolean, false) THEN
          v_motivo := 'baixado';
          UPDATE erp_remessa_pagamento_item SET status_item='pago', ocorrencia_retorno=v_ocorr WHERE id=v_item.item_id;
        ELSE
          v_resultado := 'erro_baixa'; v_err := v_err + 1; v_motivo := COALESCE(v_baixa->>'erro','falha na baixa');
          UPDATE erp_remessa_pagamento_item SET ocorrencia_retorno='ERRO_BAIXA: '||v_motivo WHERE id=v_item.item_id;
        END IF;
      END IF;
      IF v_resultado = 'pago' THEN v_pagos := v_pagos + 1; END IF;
      v_casados := v_casados || jsonb_build_object(
        'item_id', v_item.item_id, 'remessa', v_item.numero_sequencial, 'pagar_id', v_item.erp_pagar_id,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'valor_pago', v_val_pago,
        'resultado', v_resultado, 'ocorrencia', v_ocorr, 'motivo', v_motivo);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'confirmado', p_confirmar,
    'casados', v_casados, 'nao_casados', v_naocasados, 'rejeitados', v_rejeitados, 'ja_pagos', v_japagos,
    'qtd_casados', jsonb_array_length(v_casados), 'qtd_nao_casados', jsonb_array_length(v_naocasados),
    'resumo', jsonb_build_object('total', v_total, 'pagos', v_pagos, 'rejeitados', v_rej,
              'ja_pagos', v_ja, 'erros', v_err, 'nao_casados', v_nc));
END $f$;

GRANT EXECUTE ON FUNCTION public.fn_remessa_retorno_conciliar_auto(uuid, jsonb, boolean) TO authenticated;
