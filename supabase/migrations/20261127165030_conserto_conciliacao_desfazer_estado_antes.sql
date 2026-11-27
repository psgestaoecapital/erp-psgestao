-- =====================================================================
-- conserto-main(financeiro/conciliação): desfazer a conciliação volta o título ao estado ANTES de TODA a conciliação
--
-- BUG (@pos-migration vermelho · boleto-juros-conciliacao.spec.ts "desfazer: valor_pago volta a 0"; provado no dado):
--   conciliação agrupada de 2× R$100 com R$4 de juros no âncora → âncora valor_pago 104 / pago.
--   fn_conciliacao_desvincular_movimento restaurava o valor guardado em ajuste_valor_pago_antes ANTES do estorno das
--   baixas (sync), então o guarda de valor_pago gerava uma baixa de diferença que, cruzada com o estorno, deixava o
--   âncora em valor_pago 100 / pago (deveria 0 / aberto). O título SEM ajuste (sync sozinho) já voltava certo.
--
-- CORREÇÃO (Eng. Chefe 25/11): guardar em conciliacao_vinculo o ESTADO ANTES DA CONCILIAÇÃO (valor_pago, juros,
--   desconto, status) de CADA título do lote — inclusive os sem ajuste — no fechar. No desfazer: primeiro reabrir e
--   SINCRONIZAR (estorna as baixas da conciliação), e só DEPOIS restaurar valor_pago/juros/desconto a esse estado —
--   o guarda de valor_pago acerta a baixa da diferença e o status é recalculado. Vale para _movimento e _titulo (as
--   duas vias que reabrem título conciliado via sync). conciliacao_vinculo/fn_* não são tabela de domínio (RD-97 ok).
-- =====================================================================

-- (1) snapshot pré-conciliação por vínculo
ALTER TABLE public.conciliacao_vinculo
  ADD COLUMN IF NOT EXISTS antes_valor_pago numeric,
  ADD COLUMN IF NOT EXISTS antes_juros      numeric,
  ADD COLUMN IF NOT EXISTS antes_desconto   numeric,
  ADD COLUMN IF NOT EXISTS antes_status     text;

-- (2) fechar_agrupado: captura antes_* de CADA vínculo ANTES de qualquer ajuste/baixa
CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid, p_tolerancia numeric DEFAULT 0.05, p_juros numeric DEFAULT 0, p_multa numeric DEFAULT 0, p_desconto numeric DEFAULT 0, p_ajuste_lancamento_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mov record; v_soma numeric; v_vin record; v_qtd int := 0;
  v_acr numeric := round(coalesce(p_juros,0) + coalesce(p_multa,0), 2);
  v_desc numeric := round(coalesce(p_desconto,0), 2);
  v_efetivo numeric; v_anchor uuid; v_anchor_tab text;
  v_receber uuid[] := '{}';
  v_pagar uuid[] := '{}';
  v_conta uuid;
  v_conta_nome text;
  v_j_antes numeric; v_d_antes numeric; v_p_antes numeric;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
begin
  select * into v_mov from conciliacao_movimento where id = p_movimento_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado'); end if;
  if not (v_interno or auth.role()='service_role' or v_mov.company_id in (select get_user_company_ids()) or is_admin()) then
    raise exception 'Sem acesso a esta empresa' using errcode='42501';
  end if;
  if v_mov.status = 'conciliado' then
    return jsonb_build_object('ok', true, 'conciliado', true, 'ja', true, 'valor', v_mov.valor);
  end if;
  select conta_bancaria_id into v_conta from conciliacao_lote where id = v_mov.lote_id;
  select nome into v_conta_nome from erp_banco_contas where id = v_conta;
  select coalesce(sum(valor_vinculado),0) into v_soma from conciliacao_vinculo where movimento_id = p_movimento_id;
  if v_soma = 0 then return jsonb_build_object('ok', false, 'erro', 'nenhuma conta vinculada'); end if;

  -- CONSERTO: guarda o estado ANTES da conciliação de cada título (p/ o desfazer restaurar exatamente este estado).
  update conciliacao_vinculo cv set
    antes_valor_pago = case when cv.lancamento_tabela='erp_pagar'
        then (select coalesce(valor_pago,0) from erp_pagar   where id=cv.lancamento_id)
        else (select coalesce(valor_pago,0) from erp_receber where id=cv.lancamento_id) end,
    antes_juros = case when cv.lancamento_tabela='erp_pagar'
        then (select coalesce(juros,0) from erp_pagar   where id=cv.lancamento_id)
        else (select coalesce(juros,0) from erp_receber where id=cv.lancamento_id) end,
    antes_desconto = case when cv.lancamento_tabela='erp_pagar'
        then (select coalesce(desconto,0) from erp_pagar   where id=cv.lancamento_id)
        else (select coalesce(desconto,0) from erp_receber where id=cv.lancamento_id) end,
    antes_status = case when cv.lancamento_tabela='erp_pagar'
        then (select status from erp_pagar   where id=cv.lancamento_id)
        else (select status from erp_receber where id=cv.lancamento_id) end
  where cv.movimento_id = p_movimento_id;

  v_efetivo := round(v_soma + v_acr - v_desc, 2);
  if abs(abs(v_mov.valor) - v_efetivo) > p_tolerancia then
    return jsonb_build_object('ok', false, 'erro', 'soma nao fecha com a fatura',
      'valor_movimento', v_mov.valor, 'soma_vinculada', v_soma, 'acrescimo', v_acr, 'desconto', v_desc,
      'saldo', round(abs(v_mov.valor) - v_efetivo, 2));
  end if;

  if p_ajuste_lancamento_id is not null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id and lancamento_id = p_ajuste_lancamento_id limit 1;
  end if;
  if v_anchor is null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id order by valor_vinculado desc limit 1;
  end if;

  if (v_acr <> 0 or v_desc <> 0) and v_anchor is not null then
    -- estado ANTES do ajuste, p/ o desfazer restaurar (mantido por retrocompatibilidade)
    if v_anchor_tab = 'erp_pagar' then
      select coalesce(juros,0), coalesce(desconto,0), coalesce(valor_pago,0) into v_j_antes, v_d_antes, v_p_antes from erp_pagar where id = v_anchor;
    else
      select coalesce(juros,0), coalesce(desconto,0), coalesce(valor_pago,0) into v_j_antes, v_d_antes, v_p_antes from erp_receber where id = v_anchor;
    end if;

    perform fn_conciliacao_ajustar_valores(
      v_anchor, case when v_anchor_tab = 'erp_pagar' then 'pagar' else 'receber' end,
      v_acr, v_desc, coalesce(nullif(btrim(p_observacao),''), 'conciliação: diferença banco × título'), null);
    -- o acréscimo/desconto entra no valor vinculado do âncora (a baixa daquele movimento passa a ter o valor recebido)
    update conciliacao_vinculo set valor_vinculado = round(valor_vinculado + v_acr - v_desc, 2),
           ajuste_juros_antes = v_j_antes, ajuste_desconto_antes = v_d_antes, ajuste_valor_pago_antes = v_p_antes
     where movimento_id = p_movimento_id and lancamento_tabela = v_anchor_tab and lancamento_id = v_anchor;
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      update erp_pagar set conciliado = true, movimento_banco_id = p_movimento_id,
             conta_bancaria = coalesce(nullif(btrim(conta_bancaria),''), v_conta_nome),
             forma_pagamento = coalesce(nullif(forma_pagamento,''), 'cartao_credito'), updated_at = now()
        where id = v_vin.lancamento_id;
      v_pagar := array_append(v_pagar, v_vin.lancamento_id);
    else
      update erp_receber set conciliado = true, movimento_banco_id = p_movimento_id,
             conta_bancaria_id = coalesce(conta_bancaria_id, v_conta), updated_at = now()
        where id = v_vin.lancamento_id;
      v_receber := array_append(v_receber, v_vin.lancamento_id);
    end if;
    v_qtd := v_qtd + 1;
  end loop;

  update conciliacao_movimento set status='conciliado', match_origem='agrupado',
    match_aplicado_em=now(), match_aplicado_por=COALESCE(auth.uid(), p_operador_id) where id = p_movimento_id;

  perform public.fn_receber_conciliacao_sync(x) from unnest(v_receber) x;
  perform public.fn_pagar_conciliacao_sync(x) from unnest(v_pagar) x;

  -- CONSERTO: a baixa do ÂNCORA nasce com origem 'trigger_guarda' (o ajuste seta valor_pago direto e o guarda gera a
  -- baixa). Re-etiqueta como 'conciliacao' p/ o desfazer (sync) estornar essa baixa como qualquer baixa de conciliação
  -- (senão o sync só a DESLIGA e ela sobrevive, deixando o âncora pago/valor_pago>0 ao desfazer).
  if (v_acr <> 0 or v_desc <> 0) and v_anchor is not null then
    if v_anchor_tab = 'erp_pagar' then
      update erp_pagar_baixa set origem = 'conciliacao'
       where pagar_id = v_anchor and movimento_banco_id = p_movimento_id and origem = 'trigger_guarda' and deleted_at is null;
    else
      update erp_receber_baixa set origem = 'conciliacao'
       where receber_id = v_anchor and movimento_banco_id = p_movimento_id and origem = 'trigger_guarda' and deleted_at is null;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'conciliado', true, 'qtd_baixados', v_qtd,
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor);
end;
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid,uuid,numeric,numeric,numeric,numeric,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid,uuid,numeric,numeric,numeric,numeric,uuid,text) TO authenticated, service_role;

-- (3) desvincular_movimento: reabre + sincroniza (estorna as baixas) e SÓ DEPOIS restaura o estado anterior
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_movimento(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_vin        RECORD;
  v_rest       RECORD;
  v_reabertos  int := 0;
  v_com_ajuste int := 0;
  v_ajuste_ids jsonb := '[]'::jsonb;
  v_receber    uuid[] := '{}';
  v_pagar      uuid[] := '{}';
BEGIN
  SELECT * INTO v_mov FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;

  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id) THEN
    IF v_mov.status = 'conciliado' AND v_mov.lancamento_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa   b WHERE b.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_receber_baixa b WHERE b.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.movimento_banco_id = p_movimento_id)
       AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.movimento_banco_id = p_movimento_id)
    THEN
      UPDATE public.conciliacao_movimento
         SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
             match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
             updated_at = now()
       WHERE id = p_movimento_id;
      RETURN jsonb_build_object('sucesso', true, 'movimento_id', p_movimento_id,
        'titulos_reabertos', 0, 'titulos_com_ajuste', 0, 'titulos_com_ajuste_ids', '[]'::jsonb,
        'liberado_sem_vinculo', true, 'aviso', NULL);
    END IF;
    IF v_mov.lancamento_id IS NULL AND v_mov.status = 'conciliado' THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'baixa_ligada_sem_vinculo',
        'msg', 'Este movimento tem pagamento (baixa) ligado a ele, mas nenhum título na fatura. Desfaça o pagamento pelo histórico do título e tente de novo.');
    END IF;
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_vinculos',
      'msg', 'Movimento sem vínculos agrupados. Para vínculo 1:1 use a desvinculação normal.');
  END IF;

  -- estado a restaurar DEPOIS do sync (sobrevive ao DELETE dos vínculos)
  CREATE TEMP TABLE IF NOT EXISTS _desv_restore (tabela text, lanc uuid, vp numeric, j numeric, d numeric) ON COMMIT DROP;
  DELETE FROM _desv_restore WHERE true;

  IF v_mov.status = 'conciliado' THEN
    FOR v_vin IN
      SELECT cv.lancamento_tabela, cv.lancamento_id,
             cv.antes_valor_pago, cv.antes_juros, cv.antes_desconto,
             ( cv.ajuste_valor_pago_antes IS NOT NULL
               OR (cv.antes_valor_pago IS NOT NULL AND COALESCE(cv.antes_juros,0) = 0
                   AND EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = cv.lancamento_id AND COALESCE(r.juros,0) <> 0))
               OR EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.id = cv.lancamento_id
                        AND (COALESCE(p.juros,0) <> 0 OR COALESCE(p.desconto,0) <> 0
                             OR p.observacoes ILIKE '%AJUSTE%' OR p.observacoes ILIKE '%VALOR AJUSTADO%'))
               OR EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = cv.lancamento_id
                        AND (COALESCE(r.juros,0) <> 0 OR COALESCE(r.desconto,0) <> 0
                             OR r.observacoes ILIKE '%AJUSTE%' OR r.observacoes ILIKE '%VALOR AJUSTADO%')) ) AS had_ajuste
      FROM public.conciliacao_vinculo cv
      WHERE cv.movimento_id = p_movimento_id
    LOOP
      -- guarda o estado ANTES da conciliação (quando capturado no fechar); NÃO mexe em valor_pago ainda.
      IF v_vin.antes_valor_pago IS NOT NULL THEN
        INSERT INTO _desv_restore VALUES (v_vin.lancamento_tabela, v_vin.lancamento_id,
          v_vin.antes_valor_pago, COALESCE(v_vin.antes_juros,0), COALESCE(v_vin.antes_desconto,0));
      END IF;

      IF v_vin.lancamento_tabela = 'erp_pagar' THEN
        UPDATE public.erp_pagar SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_pagar := array_append(v_pagar, v_vin.lancamento_id);
      ELSE
        UPDATE public.erp_receber SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_receber := array_append(v_receber, v_vin.lancamento_id);
      END IF;

      v_reabertos := v_reabertos + 1;
      IF v_vin.had_ajuste THEN
        v_com_ajuste := v_com_ajuste + 1;
        v_ajuste_ids := v_ajuste_ids || to_jsonb(v_vin.lancamento_id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id;

  UPDATE public.conciliacao_movimento
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE id = p_movimento_id;

  -- sync estorna as baixas desta conciliação (soma das baixas volta ao estado sem este movimento)
  PERFORM public.fn_receber_conciliacao_sync(x) FROM unnest(v_receber) x;
  PERFORM public.fn_pagar_conciliacao_sync(x) FROM unnest(v_pagar) x;

  -- SÓ AGORA restaura o estado ANTES da conciliação; o guarda de valor_pago acerta a baixa da diferença e o status é recalculado
  FOR v_rest IN SELECT * FROM _desv_restore LOOP
    IF v_rest.tabela = 'erp_pagar' THEN
      UPDATE public.erp_pagar SET juros = v_rest.j, desconto = v_rest.d, valor_pago = v_rest.vp, updated_at = now()
       WHERE id = v_rest.lanc AND company_id = v_mov.company_id;
    ELSE
      UPDATE public.erp_receber SET juros = v_rest.j, desconto = v_rest.d, valor_pago = v_rest.vp, updated_at = now()
       WHERE id = v_rest.lanc AND company_id = v_mov.company_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimento_id', p_movimento_id,
    'titulos_reabertos', v_reabertos,
    'titulos_com_ajuste', v_com_ajuste,
    'titulos_com_ajuste_ids', v_ajuste_ids,
    'aviso', CASE WHEN v_com_ajuste > 0
      THEN format('%s título(s) tinham ajuste de juros/desconto: restaurado o estado anterior; confira se precisar.', v_com_ajuste)
      ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid,uuid) TO authenticated, service_role;

-- (4) desvincular_titulo: mesma correção para um título do lote (reabre + sync + restaura o estado anterior)
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_titulo(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_had_ajuste boolean := false;
  v_restantes  int;
  v_vp numeric; v_j numeric; v_d numeric;
BEGIN
  SELECT * INTO v_mov FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;

  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF p_lancamento_tabela NOT IN ('erp_pagar', 'erp_receber') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tabela_invalida',
      'msg', 'Tabela do título inválida; use a desvinculação da fatura.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conciliacao_vinculo
     WHERE movimento_id = p_movimento_id
       AND lancamento_tabela = p_lancamento_tabela
       AND lancamento_id = p_lancamento_id
  ) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'vinculo_nao_encontrado',
      'msg', 'Este título não está vinculado a esta conciliação.');
  END IF;

  -- mesmo critério de aviso do desvincular agrupado: título com ajuste de juros/desconto na conciliação
  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT EXISTS (SELECT 1 FROM public.erp_pagar p WHERE p.id = p_lancamento_id
             AND (COALESCE(p.juros,0) <> 0 OR COALESCE(p.desconto,0) <> 0
                  OR p.observacoes ILIKE '%AJUSTE%' OR p.observacoes ILIKE '%VALOR AJUSTADO%'))
      INTO v_had_ajuste;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = p_lancamento_id
             AND (COALESCE(r.juros,0) <> 0 OR COALESCE(r.desconto,0) <> 0
                  OR r.observacoes ILIKE '%AJUSTE%' OR r.observacoes ILIKE '%VALOR AJUSTADO%'))
      INTO v_had_ajuste;
  END IF;

  -- CONSERTO: guarda o estado ANTES da conciliação deste título (quando capturado no fechar)
  SELECT antes_valor_pago, antes_juros, antes_desconto INTO v_vp, v_j, v_d
    FROM public.conciliacao_vinculo
   WHERE movimento_id = p_movimento_id AND lancamento_tabela = p_lancamento_tabela AND lancamento_id = p_lancamento_id;

  -- remove só o vínculo deste título
  DELETE FROM public.conciliacao_vinculo
   WHERE movimento_id = p_movimento_id
     AND lancamento_tabela = p_lancamento_tabela
     AND lancamento_id = p_lancamento_id;

  -- reabre o título e sincroniza (o sync, lendo conciliacao_vinculo, estorna só a baixa deste movimento)
  IF p_lancamento_tabela = 'erp_pagar' THEN
    UPDATE public.erp_pagar SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id AND company_id = v_mov.company_id;
    PERFORM public.fn_pagar_conciliacao_sync(p_lancamento_id);
    IF v_vp IS NOT NULL THEN
      UPDATE public.erp_pagar SET juros = COALESCE(v_j,0), desconto = COALESCE(v_d,0), valor_pago = v_vp, updated_at = now()
       WHERE id = p_lancamento_id AND company_id = v_mov.company_id;
    END IF;
  ELSE
    UPDATE public.erp_receber SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id AND company_id = v_mov.company_id;
    PERFORM public.fn_receber_conciliacao_sync(p_lancamento_id);
    IF v_vp IS NOT NULL THEN
      UPDATE public.erp_receber SET juros = COALESCE(v_j,0), desconto = COALESCE(v_d,0), valor_pago = v_vp, updated_at = now()
       WHERE id = p_lancamento_id AND company_id = v_mov.company_id;
    END IF;
  END IF;

  -- se não sobrou nenhum vínculo, o movimento volta para Pendentes (igual ao desvincular completo)
  SELECT count(*) INTO v_restantes FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id;
  IF v_restantes = 0 THEN
    UPDATE public.conciliacao_movimento
       SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
           match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
           updated_at = now()
     WHERE id = p_movimento_id;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimento_id', p_movimento_id,
    'lancamento_id', p_lancamento_id,
    'vinculos_restantes', v_restantes,
    'movimento_liberado', (v_restantes = 0),
    'teve_ajuste', v_had_ajuste,
    'aviso', CASE WHEN v_had_ajuste
      THEN 'Este título tinha ajuste de juros/desconto na conciliação: a baixa foi estornada e o estado anterior restaurado; confira se precisar.'
      ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_desvincular_titulo(uuid,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_titulo(uuid,text,uuid,uuid) TO authenticated, service_role;
