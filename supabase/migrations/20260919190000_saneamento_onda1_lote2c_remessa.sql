-- Saneamento Onda 1 · Lote 2c — remessa/CNAB/retorno (Fase 1 · Limpeza).
-- Fecha o acesso anônimo às funções SECURITY DEFINER da família remessa (geração/retorno CNAB,
-- que criam BAIXAS em erp_pagar) e corrige o único furo de autorização real:
--   fn_remessa_retorno_processar confiava no p_company_id do cliente (só checava
--   v_rem.company_id = p_company_id) — NUNCA validava se o CHAMADOR pertence à empresa.
--   Efeito: qualquer um podia disparar processamento de retorno/baixa em remessa de qualquer empresa.
-- Também blinda fn_remessa_proxima_numeracao (sem guarda) e endurece o helper fn__remessa_pode
-- para aceitar chamadas internas/service_role/admin (mantendo a exigência de empresa p/ o usuário comum).
-- As demais (listar/datas_pagamento/marcar_incluidos/retorno_conciliar_auto/cancelar/remover_item/
-- extrato) JÁ têm guarda por empresa — aqui só recebem REVOKE anon. RDs 25·26·38·52·65.

-- ── Helper de autorização (mantém "remessa pertence à empresa" + "usuário na empresa"),
--    agora aceitando também interno (sem JWT), service_role e admin. Sem downgrade de segurança.
CREATE OR REPLACE FUNCTION public.fn__remessa_pode(p_company_id uuid, p_remessa_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_remessa_company = p_company_id AND (
       coalesce(current_setting('request.jwt.claims', true), '') = ''
    OR auth.role() = 'service_role'
    OR p_company_id IN (SELECT public.get_user_company_ids())
    OR public.is_admin()
  );
$function$;

-- ── Numeração da próxima remessa: só quem pode operar a empresa (antes: aberta a qualquer um).
CREATE OR REPLACE FUNCTION public.fn_remessa_proxima_numeracao(p_company uuid, p_banco uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
BEGIN
  IF NOT (v_interno OR auth.role() = 'service_role' OR p_company IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  RETURN GREATEST(
    coalesce((SELECT max(numero_sequencial)
                FROM public.erp_remessa_pagamento
               WHERE company_id = p_company
                 AND banco_provider_id IS NOT DISTINCT FROM p_banco), 0),
    coalesce((SELECT remessa_ultimo_numero
                FROM public.erp_banco_provider_config
               WHERE id = p_banco), 0)
  ) + 1;
END; $function$;

-- ── Retorno/CNAB: FURO CORRIGIDO. Guarda agora exige que o CHAMADOR pertença à empresa
--    (via fn__remessa_pode), não apenas que a remessa seja da empresa informada. Corpo idêntico.
CREATE OR REPLACE FUNCTION public.fn_remessa_retorno_processar(p_remessa_id uuid, p_company_id uuid, p_itens jsonb, p_conta_bancaria_id uuid DEFAULT NULL::uuid, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rem record; v_el jsonb; v_item record; v_pagar record;
  v_val_pago numeric; v_dt date; v_ocorr text; v_hint boolean;
  v_banco text; v_ef jsonb; v_efeito text;
  v_saldo numeric; v_resultado text; v_motivo text; v_baixa jsonb;
  v_pagos int := 0; v_rej int := 0; v_div int := 0; v_ja int := 0; v_err int := 0;
  v_agen int := 0; v_nrec int := 0; v_total int := 0;
  v_detalhes jsonb := '[]'::jsonb; v_status_novo text; v_arquivo text;
BEGIN
  SELECT * INTO v_rem FROM erp_remessa_pagamento WHERE id = p_remessa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Remessa não encontrada.'); END IF;
  -- SANEAMENTO 2c: exige que o chamador pertença à empresa (não confia só no p_company_id do cliente).
  IF NOT public.fn__remessa_pode(p_company_id, v_rem.company_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_total := v_total + 1;
    v_val_pago := round(COALESCE((v_el->>'val_pago')::numeric, 0), 2);
    v_dt       := NULLIF(v_el->>'dt_pagamento','')::date;
    v_ocorr    := COALESCE(v_el->>'ocorrencia','');
    v_hint     := COALESCE((v_el->>'pago_hint')::boolean, false);
    v_banco    := COALESCE(NULLIF(v_el->>'banco_codigo',''), '748');
    v_arquivo  := COALESCE(v_arquivo, NULLIF(v_el->>'arquivo_nome',''));
    v_resultado := NULL; v_motivo := NULL;

    SELECT * INTO v_item FROM erp_remessa_pagamento_item
     WHERE id = (v_el->>'item_id')::uuid AND remessa_id = p_remessa_id;
    IF NOT FOUND THEN
      v_resultado := 'nao_casado'; v_motivo := 'item não pertence a esta remessa';
      v_detalhes := v_detalhes || jsonb_build_object('item_id', v_el->>'item_id', 'resultado', v_resultado, 'motivo', v_motivo);
      CONTINUE;
    END IF;
    SELECT * INTO v_pagar FROM erp_pagar WHERE id = v_item.erp_pagar_id;

    -- QUEM DECIDE O EFEITO E O BANCO (o mapa), nao mais o front (#29).
    v_ef := public.fn_remessa_ocorrencia_efeito(v_banco, v_ocorr, v_el->>'cod_movimento');
    v_efeito := v_ef->>'efeito';

    IF v_item.status_item = 'pago' THEN
      v_ja := v_ja + 1; v_resultado := 'ja_pago'; v_motivo := 'já baixado por um retorno anterior (idempotente)';

    ELSIF v_efeito = 'nao_reconhecido' THEN
      -- codigo desconhecido NUNCA liquida. O titulo VOLTA ao estado anterior a remessa.
      v_nrec := v_nrec + 1; v_resultado := 'nao_reconhecido'; v_motivo := v_ef->>'motivo';
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item
           SET status_item = 'nao_reconhecido', ocorrencia_retorno = v_ocorr, remocao_motivo = v_motivo
         WHERE id = v_item.id;
        UPDATE erp_pagar SET status = COALESCE(status_pre_remessa, 'aberto')
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
      END IF;

    ELSIF v_efeito = 'agendar' THEN
      v_agen := v_agen + 1; v_resultado := 'agendado';
      v_motivo := COALESCE(NULLIF(v_ef->>'motivo',''), 'agendado pelo banco');
      IF p_confirmar THEN
        UPDATE erp_pagar SET status_pre_remessa = COALESCE(status_pre_remessa, status), status = 'agendado'
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
        UPDATE erp_remessa_pagamento_item SET status_item = 'agendado', ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
      END IF;

    ELSIF v_efeito = 'confirmar' THEN
      v_resultado := 'confirmado'; v_motivo := 'confirmação de recebimento (sem baixa)';
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
      END IF;

    ELSIF v_efeito <> 'liquidar' THEN
      -- rejeitar (mapeado): reverte pro status pre-remessa
      v_rej := v_rej + 1; v_resultado := 'rejeitado';
      v_motivo := 'rejeitado pelo banco · ocorrência ' || COALESCE(NULLIF(v_ocorr,''),'—')
                  || COALESCE(' — ' || NULLIF(v_ef->>'motivo',''), '');
      IF p_confirmar THEN
        UPDATE erp_pagar SET status = COALESCE(status_pre_remessa, 'aberto')
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
        UPDATE erp_remessa_pagamento_item SET status_item = 'rejeitado', ocorrencia_retorno = v_ocorr, remocao_motivo = v_motivo WHERE id = v_item.id;
      END IF;

    ELSIF NOT v_hint OR v_val_pago <= 0 OR v_dt IS NULL THEN
      -- liquidar, mas o parser NAO viu data/valor: salvaguarda adicional, NAO baixa.
      v_rej := v_rej + 1; v_resultado := 'rejeitado';
      v_motivo := 'banco liquidou mas sem data/valor confirmados no retorno · ocorrência ' || COALESCE(v_ocorr,'—');
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET status_item = 'rejeitado', ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
      END IF;

    ELSE
      -- liquidar com data/valor: mantem a checagem de divergencia e a baixa.
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
          v_pagos := v_pagos + 1; v_resultado := 'pago'; v_motivo := 'será baixado';
        END IF;
      END IF;
    END IF;

    v_detalhes := v_detalhes || jsonb_build_object(
      'item_id', v_item.id, 'pagar_id', v_item.erp_pagar_id, 'resultado', v_resultado, 'efeito', v_efeito,
      'val_pago', v_val_pago, 'val_titulo', v_pagar.valor,
      'saldo', round(COALESCE(v_pagar.valor,0) - COALESCE(v_pagar.valor_pago,0), 2),
      'ocorrencia', v_ocorr, 'motivo', v_motivo);
  END LOOP;

  IF p_confirmar THEN
    SELECT CASE WHEN count(*) FILTER (WHERE status_item <> 'pago') = 0 THEN 'concluido' ELSE 'retorno_parcial' END
      INTO v_status_novo FROM erp_remessa_pagamento_item WHERE remessa_id = p_remessa_id;
    UPDATE erp_remessa_pagamento
       SET retorno_importado_em = now(), status = v_status_novo,
           retorno_arquivo_nome = COALESCE(v_arquivo, retorno_arquivo_nome),
           itens_nao_reconhecidos = (SELECT count(*) FROM erp_remessa_pagamento_item
                                      WHERE remessa_id = p_remessa_id AND status_item = 'nao_reconhecido')
     WHERE id = p_remessa_id;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true, 'confirmado', p_confirmar,
    'remessa_status', v_status_novo,
    'resumo', jsonb_build_object('total', v_total, 'pagos', v_pagos, 'agendados', v_agen, 'rejeitados', v_rej,
                                 'divergentes', v_div, 'ja_pagos', v_ja, 'nao_reconhecidos', v_nrec, 'erros', v_err),
    'detalhes', v_detalhes);
END; $function$;

-- ── REVOKE anon + GRANT em toda a família remessa (SECURITY DEFINER).
REVOKE EXECUTE ON FUNCTION public.fn__remessa_pode(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_proxima_numeracao(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_retorno_processar(uuid, uuid, jsonb, uuid, boolean) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_cancelar(uuid, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_remover_item(uuid, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_extrato(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_listar(uuid, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_datas_pagamento(uuid[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_marcar_incluidos(uuid[], uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_retorno_conciliar_auto(uuid, jsonb, boolean) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_remessa_item_antidup() FROM anon, public;

GRANT EXECUTE ON FUNCTION public.fn__remessa_pode(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_proxima_numeracao(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_retorno_processar(uuid, uuid, jsonb, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_cancelar(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_remover_item(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_extrato(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_listar(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_datas_pagamento(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_marcar_incluidos(uuid[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_remessa_retorno_conciliar_auto(uuid, jsonb, boolean) TO authenticated, service_role;
