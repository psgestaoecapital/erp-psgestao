-- RD-41 · Corrige o impasse de exclusão (Julia/Jordana): "cancele a conciliação antes de excluir" aparecia
-- mesmo SEM conciliação (ex.: Proplay e2056937 — status=pago, conciliado=false, ZERO vínculos). A trava antiga
-- bloqueava em `status='pago' OR conciliado` e SEMPRE mandava "desvincule no inbox" — ação impossível quando
-- não há conciliação, e sem saída pela linha. Escala: 274 lançamentos pagos-sem-conciliação só na Proplay.
--
-- FIX (RD-38, geral p/ todos os tenants — nada hardcoded):
--  1) Só bloqueia por CONCILIAÇÃO se existe VÍNCULO REAL no banco (conciliacao_vinculo/movimento apontando o
--     lançamento) — a flag `conciliado` sozinha não basta. (Bloquear no vínculo é o financeiramente correto:
--     é o que orfanaria um movimento bancário.)
--  2) Pago SEM conciliação: não trava — permite CANCELAR A BAIXA e excluir (p_cancelar_baixa=true).
--  3) Mensagens honestas (RD-51): conciliação vs baixa — nunca pedir para desconciliar o que não está conciliado.
--  RD-55: exclusão de pago cancela a baixa (reset consistente) + trilha em erp_lancamento_log (EXCLUIU/CANCELOU_BAIXA).

-- overload guard: remove a assinatura antiga (1 arg) antes de recriar com o param novo (evita ambiguidade)
DROP FUNCTION IF EXISTS public.fn_pagar_excluir(uuid);
DROP FUNCTION IF EXISTS public.fn_receber_excluir(uuid);

CREATE OR REPLACE FUNCTION public.fn_pagar_excluir(p_id uuid, p_cancelar_baixa boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_registro jsonb; v_status text; v_conciliado boolean; v_company_id uuid; v_del timestamptz;
        v_tem_concil boolean; v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(p.*), p.status, p.conciliado, p.company_id, p.deleted_at
    INTO v_registro, v_status, v_conciliado, v_company_id, v_del
  FROM public.erp_pagar p WHERE p.id = p_id;
  IF v_registro IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF v_del IS NOT NULL THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'ja_excluido', true); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;

  -- conciliação REAL = existe vínculo/movimento apontando este lançamento (a flag sozinha não conta)
  v_tem_concil := EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.lancamento_tabela='erp_pagar' AND v.lancamento_id=p_id)
               OR EXISTS (SELECT 1 FROM public.conciliacao_movimento m WHERE m.lancamento_tabela='erp_pagar' AND m.lancamento_id=p_id);

  IF v_tem_concil THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado',
      'orientacao', 'Este lançamento está conciliado com o banco. Cancele a conciliação no inbox antes de excluir.');
  END IF;

  -- pago sem conciliação: o que trava é a BAIXA — só segue se o usuário confirmar cancelar a baixa
  IF v_status = 'pago' AND NOT p_cancelar_baixa THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'requer_cancelar_baixa', 'pode_cancelar_baixa', true,
      'orientacao', 'Este lançamento está baixado (pago), mas não está conciliado. Cancelar a baixa e excluir?');
  END IF;

  IF v_status = 'pago' THEN  -- cancela a baixa (reset consistente) antes do soft-delete
    INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
    VALUES (p_id, v_email, 'CANCELOU_BAIXA', jsonb_build_object('motivo','exclusao','registro', v_registro), 'erp_pagar');
    UPDATE public.erp_pagar
       SET status='aberto', valor_pago=0, data_pagamento=NULL, conciliado=false, updated_at=now()
     WHERE id = p_id;
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_pagar');
  UPDATE public.erp_pagar SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'baixa_cancelada', (v_status='pago'));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_receber_excluir(p_id uuid, p_cancelar_baixa boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_registro jsonb; v_status text; v_conciliado boolean; v_company_id uuid; v_del timestamptz;
        v_boleto_emitido timestamptz; v_boleto_status text; v_tem_concil boolean;
        v_email text := public.fn_user_email_atual();
BEGIN
  SELECT to_jsonb(r.*), r.status, r.conciliado, r.company_id, r.deleted_at, r.boleto_emitido_em, r.boleto_status
    INTO v_registro, v_status, v_conciliado, v_company_id, v_del, v_boleto_emitido, v_boleto_status
  FROM public.erp_receber r WHERE r.id = p_id;
  IF v_registro IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'nao_encontrado'); END IF;
  IF v_del IS NOT NULL THEN RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'ja_excluido', true); END IF;
  IF NOT (v_company_id IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso'); END IF;

  v_tem_concil := EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.lancamento_tabela='erp_receber' AND v.lancamento_id=p_id)
               OR EXISTS (SELECT 1 FROM public.conciliacao_movimento m WHERE m.lancamento_tabela='erp_receber' AND m.lancamento_id=p_id);

  IF v_tem_concil THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_conciliado',
      'orientacao', 'Este lançamento está conciliado com o banco. Cancele a conciliação no inbox antes de excluir.');
  END IF;

  -- boleto ativo continua bloqueando (o banco cobraria um título inexistente) — independe de baixa/conciliação
  IF v_boleto_emitido IS NOT NULL
     AND COALESCE(lower(v_boleto_status), '') NOT IN ('cancelado','cancelada','baixado','baixada','expirado','expirada') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'bloqueado_boleto_ativo',
      'orientacao', 'Este título tem boleto emitido no banco. Cancele o boleto primeiro — senão o banco continua cobrando um título que não existe mais no sistema. Depois exclua.');
  END IF;

  IF v_status = 'pago' AND NOT p_cancelar_baixa THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'requer_cancelar_baixa', 'pode_cancelar_baixa', true,
      'orientacao', 'Este lançamento está baixado (recebido), mas não está conciliado. Cancelar a baixa e excluir?');
  END IF;

  IF v_status = 'pago' THEN
    INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
    VALUES (p_id, v_email, 'CANCELOU_BAIXA', jsonb_build_object('motivo','exclusao','registro', v_registro), 'erp_receber');
    UPDATE public.erp_receber
       SET status='aberto', valor_pago=0, data_pagamento=NULL, conciliado=false, updated_at=now()
     WHERE id = p_id;
  END IF;

  INSERT INTO public.erp_lancamento_log (lancamento_id, user_email, acao, campos_alterados, tabela_origem)
  VALUES (p_id, v_email, 'EXCLUIU', jsonb_build_object('registro', v_registro), 'erp_receber');
  UPDATE public.erp_receber SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('sucesso', true, 'id', p_id, 'baixa_cancelada', (v_status='pago'));
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_pagar_excluir(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receber_excluir(uuid, boolean) TO authenticated;

-- MASSA (RD-55: NÃO cancela baixa automaticamente — pago/conciliado é IGNORADO e contado). Reconhece os
-- códigos novos (bloqueado_conciliado / requer_cancelar_baixa) como "ignorado por pago/conciliado".
CREATE OR REPLACE FUNCTION public.fn_pagar_excluir_massa(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_id uuid; v_res jsonb; v_ok int := 0; v_bloq int := 0; v_ja int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    v_res := public.fn_pagar_excluir(v_id, false);  -- massa nunca cancela baixa sozinha
    IF (v_res->>'sucesso')::boolean IS TRUE AND COALESCE((v_res->>'ja_excluido')::boolean, false) THEN v_ja := v_ja + 1;
    ELSIF (v_res->>'sucesso')::boolean IS TRUE THEN v_ok := v_ok + 1;
    ELSIF v_res->>'erro' IN ('bloqueado_conciliado','requer_cancelar_baixa','bloqueado_conciliado_ou_pago') THEN v_bloq := v_bloq + 1;
    ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'excluidos', v_ok, 'ignoradas_pago_conciliado', v_bloq,
    'ja_excluidas', v_ja, 'outras_falhas', jsonb_array_length(v_erros), 'detalhe', v_erros);
END; $function$;
GRANT EXECUTE ON FUNCTION public.fn_pagar_excluir_massa(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_receber_excluir_massa(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_id uuid; v_res jsonb; v_ok int := 0; v_bloq int := 0; v_bol int := 0; v_ja int := 0; v_erros jsonb := '[]'::jsonb;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids,1) IS NULL THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_ids'); END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    v_res := public.fn_receber_excluir(v_id, false);
    IF (v_res->>'sucesso')::boolean IS TRUE AND COALESCE((v_res->>'ja_excluido')::boolean, false) THEN v_ja := v_ja + 1;
    ELSIF (v_res->>'sucesso')::boolean IS TRUE THEN v_ok := v_ok + 1;
    ELSIF v_res->>'erro' IN ('bloqueado_conciliado','requer_cancelar_baixa','bloqueado_conciliado_ou_pago') THEN v_bloq := v_bloq + 1;
    ELSIF v_res->>'erro' = 'bloqueado_boleto_ativo' THEN v_bol := v_bol + 1;
    ELSE v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', v_res->>'erro');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('sucesso', true, 'excluidos', v_ok, 'ignoradas_pago_conciliado', v_bloq,
    'ignoradas_boleto_ativo', v_bol, 'ja_excluidas', v_ja, 'outras_falhas', jsonb_array_length(v_erros), 'detalhe', v_erros);
END; $function$;
GRANT EXECUTE ON FUNCTION public.fn_receber_excluir_massa(uuid[]) TO authenticated;
