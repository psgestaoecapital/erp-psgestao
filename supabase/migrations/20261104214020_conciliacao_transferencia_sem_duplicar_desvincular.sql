-- Chamado #6734 (Proplay) — Conciliação de transferência entre contas:
--  (1) conciliar o 2º lado de uma transferência que já existe NÃO cria outra (liga o movimento à existente);
--  (2) "Desvincular" passa a aceitar conciliação do tipo transferência (antes: tipo_invalido);
--  (3) dado: remove a duplicada 84414529… da Proplay (com backup) e devolve o movimento b5fc01ba… a Pendentes.
-- Code: jordana-code · Faixa de migration 20.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) fn_conciliacao_transferir — reaproveita a transferência do outro lado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_transferir(p_movimento_id uuid, p_conta_contraparte_id uuid, p_descricao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mov RECORD; v_conta_mov uuid; v_origem uuid; v_destino uuid; v_transf_id uuid; v_ok_contra boolean;
        v_reaproveitada boolean := false;
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

  -- Decide SOMENTE pela natureza do movimento (credito/debito); 'valor' vem sempre absoluto.
  IF lower(coalesce(v_mov.natureza,'')) IN ('credito','c') THEN
    v_destino := v_conta_mov; v_origem := p_conta_contraparte_id;
  ELSIF lower(coalesce(v_mov.natureza,'')) IN ('debito','d') THEN
    v_origem := v_conta_mov; v_destino := p_conta_contraparte_id;
  ELSE
    RETURN jsonb_build_object('ok',false,'erro','natureza do movimento desconhecida: '||coalesce(v_mov.natureza,'(vazia)'));
  END IF;

  -- #6734: o mesmo PIX aparece como saída numa conta e entrada na outra. Se o OUTRO lado já foi conciliado
  -- (transferência de mesma empresa, data, valor, origem e destino, ainda sem o 2º movimento ligado),
  -- liga este movimento a ela em vez de criar uma transferência nova (que duplicava o saldo das duas contas).
  SELECT t.id INTO v_transf_id
    FROM erp_transferencia t
   WHERE t.company_id = v_mov.company_id
     AND t.conta_origem_id = v_origem AND t.conta_destino_id = v_destino
     AND t.valor = abs(v_mov.valor) AND t.data = v_mov.data_transacao
     AND t.movimento_id IS NOT NULL AND t.movimento_id <> p_movimento_id
     AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento x
                      WHERE x.lancamento_tabela = 'erp_transferencia' AND x.lancamento_id = t.id
                        AND x.id <> t.movimento_id)
     AND EXISTS (SELECT 1 FROM conciliacao_movimento o JOIN conciliacao_lote ol ON ol.id = o.lote_id
                  WHERE o.id = t.movimento_id AND o.status = 'conciliado'
                    AND ol.conta_bancaria_id IS DISTINCT FROM v_conta_mov)
   ORDER BY t.created_at
   LIMIT 1;

  IF v_transf_id IS NOT NULL THEN
    v_reaproveitada := true;
  ELSE
    INSERT INTO erp_transferencia(company_id, conta_origem_id, conta_destino_id, valor, data, descricao, movimento_id)
    VALUES (v_mov.company_id, v_origem, v_destino, abs(v_mov.valor), v_mov.data_transacao,
            COALESCE(p_descricao, v_mov.descricao), p_movimento_id)
    RETURNING id INTO v_transf_id;
  END IF;

  UPDATE conciliacao_movimento
     SET status='conciliado', lancamento_tabela='erp_transferencia', lancamento_id=v_transf_id,
         match_origem='transferencia', match_aplicado_em=now(), match_aplicado_por=auth.uid(),
         updated_at=now()
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object('ok',true,'transferencia_id',v_transf_id,
    'origem',v_origem,'destino',v_destino,'valor',abs(v_mov.valor),
    'transferencia_reaproveitada',v_reaproveitada);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_transferir(uuid, uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_transferir(uuid, uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fn_conciliacao_desvincular — aceita 'transferencia' (corpo de pagar/receber INALTERADO)
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_transf RECORD;
  v_transf_apagadas int := 0;
BEGIN
  IF v_tipo NOT IN ('pagar','receber','transferencia') THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'tipo_invalido', 'tipo_recebido', p_tipo);
  END IF;

  -- #6734: transferência entre contas — remove a transferência e libera os movimentos ligados a ela
  -- (um ou os dois lados) para Pendentes. Só da empresa do usuário.
  IF v_tipo = 'transferencia' THEN
    SELECT id, company_id, movimento_id INTO v_transf
      FROM public.erp_transferencia
     WHERE id = p_lancamento_id AND company_id IN (SELECT get_user_company_ids());
    IF NOT FOUND THEN
      RETURN jsonb_build_object('sucesso', false, 'erro', 'nenhum_movimento_encontrado',
                                'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
    END IF;

    UPDATE public.conciliacao_movimento
       SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
           match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
           updated_at = now()
     WHERE company_id = v_transf.company_id
       AND ( (lancamento_tabela = 'erp_transferencia' AND lancamento_id = p_lancamento_id)
          OR (id = v_transf.movimento_id AND status = 'conciliado' AND lancamento_tabela IS NOT DISTINCT FROM 'erp_transferencia') );
    GET DIAGNOSTICS v_mov_count = ROW_COUNT;

    DELETE FROM public.erp_transferencia WHERE id = p_lancamento_id AND company_id = v_transf.company_id;
    GET DIAGNOSTICS v_transf_apagadas = ROW_COUNT;

    RETURN jsonb_build_object('sucesso', true,
                              'movimentos_resetados', v_mov_count,
                              'transferencias_removidas', v_transf_apagadas,
                              'vinculos_removidos', 0,
                              'agrupados_liberados', 0,
                              'lancamento_id', p_lancamento_id, 'tipo', v_tipo);
  END IF;

  v_tabela := 'erp_' || v_tipo;

  -- Reseta o movimento bancário -> pendente (dispara CENARIO A do trigger = estorno da baixa)
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

  -- Reverte o vínculo no título (guard multi-tenant P2)
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

  -- CONC-2 (RAIZ): apaga o vínculo — sem isso ele fica órfão e a tela mantém o título "conciliado".
  WITH apagados AS (
    DELETE FROM public.conciliacao_vinculo
     WHERE lancamento_id = p_lancamento_id
       AND lancamento_tabela = v_tabela
       AND company_id IN (SELECT get_user_company_ids())
    RETURNING movimento_id
  )
  SELECT count(*), COALESCE(array_agg(DISTINCT movimento_id), '{}') INTO v_vin_count, v_movs_agrup FROM apagados;

  -- #3963: fatura AGRUPADA que ficou sem nenhum título (e sem baixa ligada) volta para Pendentes.
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

  -- Só falha se NADA foi desfeito (nem movimento resetado, nem vínculo removido).
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

REVOKE EXECUTE ON FUNCTION public.fn_conciliacao_desvincular(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_conciliacao_desvincular(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Dado (Proplay, UMA empresa): remove a transferência duplicada, com backup
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS rls2_backup;
REVOKE ALL ON SCHEMA rls2_backup FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS rls2_backup.bkp_6734_transferencia AS
  SELECT * FROM public.erp_transferencia WHERE id = '84414529-715f-4a2b-8bca-a260525bfeae';
CREATE TABLE IF NOT EXISTS rls2_backup.bkp_6734_movimento AS
  SELECT * FROM public.conciliacao_movimento WHERE id = 'b5fc01ba-30ad-4313-b724-b07c37bb2f8c';
REVOKE ALL ON rls2_backup.bkp_6734_transferencia, rls2_backup.bkp_6734_movimento FROM PUBLIC, anon, authenticated;

-- Só mexe se a linha ainda é exatamente a duplicada (mesma empresa/valor/contas/movimento) e a original existe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.erp_transferencia
              WHERE id = 'd1124f53-4aed-482d-be81-360c8f8014b4'
                AND company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490')
     AND EXISTS (SELECT 1 FROM public.erp_transferencia
              WHERE id = '84414529-715f-4a2b-8bca-a260525bfeae'
                AND company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'
                AND valor = 400 AND data = DATE '2026-08-13'
                AND movimento_id = 'b5fc01ba-30ad-4313-b724-b07c37bb2f8c')
  THEN
    UPDATE public.conciliacao_movimento
       SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
           match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
           updated_at = now()
     WHERE id = 'b5fc01ba-30ad-4313-b724-b07c37bb2f8c'
       AND company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490';
    DELETE FROM public.erp_transferencia
     WHERE id = '84414529-715f-4a2b-8bca-a260525bfeae'
       AND company_id = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490';
  END IF;
END $$;
