-- Chamado Proplay (jordana-code, msg e1bab4dc): PIX de R$ 400 em 13/08/2026 (Cresol -> Sicoob) com 2 linhas em
-- erp_transferencia. (1) corrige o dado da Proplay (com backup); (2) fn_conciliacao_desvincular aceita 'transferencia';
-- (3) fn_conciliacao_transferir reaproveita a transferência existente em vez de criar outra.

-- 1) Backup + correção do dado (UMA empresa; escopo por id)
CREATE TABLE IF NOT EXISTS public.bkp_erp_transferencia_proplay_dup AS
  SELECT * FROM public.erp_transferencia WHERE id = '84414529-715f-4a2b-8bca-a260525bfeae';
CREATE TABLE IF NOT EXISTS public.bkp_conciliacao_movimento_proplay_dup AS
  SELECT * FROM public.conciliacao_movimento WHERE id = 'b5fc01ba-30ad-4313-b724-b07c37bb2f8c';
ALTER TABLE public.bkp_erp_transferencia_proplay_dup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_conciliacao_movimento_proplay_dup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_erp_transferencia_proplay_dup, public.bkp_conciliacao_movimento_proplay_dup FROM anon, authenticated;

UPDATE public.conciliacao_movimento
   SET status='pendente', lancamento_tabela=NULL, lancamento_id=NULL, match_score=NULL, match_origem=NULL,
       match_aplicado_em=NULL, match_aplicado_por=NULL, updated_at=now()
 WHERE id='b5fc01ba-30ad-4313-b724-b07c37bb2f8c'
   AND company_id='b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
   AND lancamento_id='84414529-715f-4a2b-8bca-a260525bfeae';

DELETE FROM public.erp_transferencia
 WHERE id='84414529-715f-4a2b-8bca-a260525bfeae'
   AND company_id='b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
   AND valor=400 AND data='2026-08-13';

-- 2) Desvincular conciliação de transferência
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular(p_lancamento_id uuid, p_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo   text := lower(regexp_replace(coalesce(p_tipo, ''), '^erp_', ''));
  v_tabela text;
  v_mov_count int := 0;
  v_vin_count int := 0;
  v_movs_agrup uuid[] := '{}';
  v_agrup_liberados int := 0;
  v_transf_del int := 0;
BEGIN
  IF v_tipo NOT IN ('pagar','receber','transferencia') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tipo_invalido', 'tipo_recebido', p_tipo);
  END IF;

  IF v_tipo = 'transferencia' THEN
    -- libera TODOS os movimentos ligados à transferência e remove a transferência (guard multi-tenant)
    UPDATE public.conciliacao_movimento
       SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL, match_score = NULL,
           match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL, updated_at = now()
     WHERE lancamento_id = p_lancamento_id
       AND lancamento_tabela = 'erp_transferencia'
       AND company_id IN (SELECT get_user_company_ids());
    GET DIAGNOSTICS v_mov_count = ROW_COUNT;
    DELETE FROM public.erp_transferencia
     WHERE id = p_lancamento_id AND company_id IN (SELECT get_user_company_ids());
    GET DIAGNOSTICS v_transf_del = ROW_COUNT;
    IF v_mov_count = 0 AND v_transf_del = 0 THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'nenhum_movimento_encontrado',
                                'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
    END IF;
    RETURN jsonb_build_object('sucesso', true, 'movimentos_resetados', v_mov_count,
                              'transferencias_removidas', v_transf_del,
                              'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
  END IF;

  v_tabela := 'erp_' || v_tipo;

  UPDATE public.conciliacao_movimento
     SET status = 'pendente',
         lancamento_tabela = NULL,
         lancamento_id = NULL,
         match_score = NULL,
         match_origem = NULL,
         match_aplicado_em = NULL,
         match_aplicado_por = NULL,
         updated_at = now()
   WHERE lancamento_id = p_lancamento_id
     AND lancamento_tabela = v_tabela
     AND company_id IN (SELECT get_user_company_ids());
  GET DIAGNOSTICS v_mov_count = ROW_COUNT;

  IF v_tipo = 'pagar' THEN
    UPDATE public.erp_pagar
       SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id
       AND company_id IN (SELECT get_user_company_ids());
  ELSE
    UPDATE public.erp_receber
       SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
     WHERE id = p_lancamento_id
       AND company_id IN (SELECT get_user_company_ids());
  END IF;

  WITH apagados AS (
    DELETE FROM public.conciliacao_vinculo
     WHERE lancamento_id = p_lancamento_id
       AND lancamento_tabela = v_tabela
       AND company_id IN (SELECT get_user_company_ids())
    RETURNING movimento_id
  )
  SELECT count(*), COALESCE(array_agg(DISTINCT movimento_id), '{}') INTO v_vin_count, v_movs_agrup FROM apagados;

  UPDATE public.conciliacao_movimento m
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE m.id = ANY (v_movs_agrup)
     AND m.status = 'conciliado'
     AND m.lancamento_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.movimento_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa   b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber_baixa b WHERE b.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.movimento_banco_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.movimento_banco_id = m.id);
  GET DIAGNOSTICS v_agrup_liberados = ROW_COUNT;

  IF v_mov_count = 0 AND v_vin_count = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'nenhum_movimento_encontrado',
                              'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
  END IF;

  RETURN jsonb_build_object('sucesso', true,
                            'movimentos_resetados', v_mov_count,
                            'vinculos_removidos', v_vin_count,
                            'agrupados_liberados', v_agrup_liberados,
                            'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
END
$function$;

-- 3) Conciliar o 2º lado de uma transferência existente liga ao mesmo registro (não cria outro)
CREATE OR REPLACE FUNCTION public.fn_conciliacao_transferir(p_movimento_id uuid, p_conta_contraparte_id uuid, p_descricao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mov RECORD; v_conta_mov uuid; v_origem uuid; v_destino uuid; v_transf_id uuid; v_ok_contra boolean; v_existente uuid;
BEGIN
  SELECT cm.company_id, cm.natureza, cm.valor, cm.data_transacao, cm.descricao, cm.status,
         l.conta_bancaria_id AS conta_mov
    INTO v_mov
  FROM conciliacao_movimento cm JOIN conciliacao_lote l ON l.id = cm.lote_id
  WHERE cm.id = p_movimento_id;
  IF v_mov.company_id IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','movimento nao encontrado'); END IF;
  IF v_mov.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN jsonb_build_object('ok',false,'erro','movimento ja processado: '||v_mov.status); END IF;

  v_conta_mov := v_mov.conta_mov;
  IF v_conta_mov IS NULL OR p_conta_contraparte_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'erro','conta indefinida'); END IF;
  IF v_conta_mov = p_conta_contraparte_id THEN
    RETURN jsonb_build_object('ok',false,'erro','origem e destino iguais'); END IF;

  SELECT true INTO v_ok_contra FROM erp_banco_contas
   WHERE id = p_conta_contraparte_id AND company_id = v_mov.company_id;
  IF NOT COALESCE(v_ok_contra,false) THEN
    RETURN jsonb_build_object('ok',false,'erro','conta contraparte invalida'); END IF;

  IF lower(coalesce(v_mov.natureza,'')) IN ('credito','c') THEN
    v_destino := v_conta_mov; v_origem := p_conta_contraparte_id;
  ELSIF lower(coalesce(v_mov.natureza,'')) IN ('debito','d') THEN
    v_origem := v_conta_mov; v_destino := p_conta_contraparte_id;
  ELSE
    RETURN jsonb_build_object('ok',false,'erro','natureza do movimento desconhecida: '||coalesce(v_mov.natureza,'(vazia)'));
  END IF;

  -- Já existe a transferência (mesmo valor, data e contas) conciliada pelo OUTRO lado? Liga a ela.
  SELECT t.id INTO v_existente
    FROM erp_transferencia t
   WHERE t.company_id = v_mov.company_id AND t.conta_origem_id = v_origem AND t.conta_destino_id = v_destino
     AND t.valor = abs(v_mov.valor) AND t.data = v_mov.data_transacao
     AND t.movimento_id IS DISTINCT FROM p_movimento_id
     AND EXISTS (SELECT 1 FROM conciliacao_movimento o WHERE o.lancamento_id = t.id
                  AND o.lancamento_tabela = 'erp_transferencia' AND o.status = 'conciliado')
     AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento p WHERE p.lancamento_id = t.id
                      AND p.lancamento_tabela = 'erp_transferencia' AND p.id <> t.movimento_id)
   ORDER BY t.created_at LIMIT 1;

  IF v_existente IS NOT NULL THEN
    UPDATE conciliacao_movimento
       SET status='conciliado', lancamento_tabela='erp_transferencia', lancamento_id=v_existente,
           match_origem='transferencia', match_aplicado_em=now(), match_aplicado_por=auth.uid(),
           updated_at=now()
     WHERE id = p_movimento_id;
    RETURN jsonb_build_object('ok',true,'transferencia_id',v_existente,'reaproveitada',true,
      'origem',v_origem,'destino',v_destino,'valor',abs(v_mov.valor));
  END IF;

  INSERT INTO erp_transferencia(company_id, conta_origem_id, conta_destino_id, valor, data, descricao, movimento_id)
  VALUES (v_mov.company_id, v_origem, v_destino, abs(v_mov.valor), v_mov.data_transacao,
          COALESCE(p_descricao, v_mov.descricao), p_movimento_id)
  RETURNING id INTO v_transf_id;

  UPDATE conciliacao_movimento
     SET status='conciliado', lancamento_tabela='erp_transferencia', lancamento_id=v_transf_id,
         match_origem='transferencia', match_aplicado_em=now(), match_aplicado_por=auth.uid(),
         updated_at=now()
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object('ok',true,'transferencia_id',v_transf_id,
    'origem',v_origem,'destino',v_destino,'valor',abs(v_mov.valor));
END $function$;

-- Guarda de funções (check_fn_guards, regra revoke_anon): SECURITY DEFINER sem acesso anônimo.
REVOKE ALL ON FUNCTION public.fn_conciliacao_desvincular(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_conciliacao_transferir(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_transferir(uuid, uuid, text) TO authenticated, service_role;
