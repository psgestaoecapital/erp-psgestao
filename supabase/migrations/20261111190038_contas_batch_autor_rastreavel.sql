-- Contas a Pagar e Receber (/dashboard/contas) — RD-98 p4: exclusão/baixa RASTREÁVEL
-- Gap aud8 94/95 (tarefa PDCA GE · /dashboard/contas): as RPCs batch_baixa_titulos e
-- batch_cancelar_titulos mudam o status (baixado/cancelado) de títulos de dinheiro mas
-- NÃO gravavam QUEM executou (p_usuario_id era IGNORADO; nada em audit_log_global).
--
-- Esta migration é ADITIVA: mantém assinatura, tipo de retorno e a guarda de membership
-- INTACTAS; só passa a REGISTRAR o autor (auth.uid() com fallback p_usuario_id) em
-- audit_log_global a cada título baixado/cancelado, mirroring o contrato já usado por
-- fn_agency_contrato_mudar_status / fn_pm_evento_pagar_vincular.
-- Autor nunca forjado: a fonte primária é auth.uid() (JWT do usuário logado).
-- NÃO altera/apaga dado de cliente além da mudança de status que a própria RPC já fazia.
-- Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.batch_baixa_titulos(
  p_lancamento_ids uuid[],
  p_data_pagamento date,
  p_banco_conta_id uuid DEFAULT NULL::uuid,
  p_forma_pagamento character varying DEFAULT NULL::character varying,
  p_usuario_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(total_processados integer, total_sucesso integer, total_erros integer, mensagem text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proc INT := 0; v_ok INT := 0; v_err INT := 0; v_id UUID; v_valor DECIMAL; v_found BOOL;
  v_company UUID;
  v_autor UUID := COALESCE(auth.uid(), p_usuario_id);
  v_email TEXT := (SELECT email FROM users WHERE id = COALESCE(auth.uid(), p_usuario_id));
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  -- guarda: authenticated só pode mexer em títulos das SUAS empresas (interno/cron/service_role/admin passa).
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) THEN
    IF EXISTS (
      SELECT 1 FROM erp_pagar   WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
      UNION ALL
      SELECT 1 FROM erp_receber WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
    ) THEN RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501'; END IF;
  END IF;

  FOREACH v_id IN ARRAY p_lancamento_ids LOOP
    v_proc := v_proc + 1; v_found := false; v_company := NULL;
    BEGIN
      UPDATE erp_pagar
         SET status='pago', data_pagamento=p_data_pagamento, valor_pago=valor,
             forma_pagamento=COALESCE(p_forma_pagamento, forma_pagamento),
             conta_bancaria=COALESCE(p_banco_conta_id::text, conta_bancaria), updated_at=NOW()
       WHERE id=v_id AND status<>'cancelado' RETURNING valor, company_id INTO v_valor, v_company;
      IF FOUND THEN
        v_found := true;
        IF p_banco_conta_id IS NOT NULL THEN
          UPDATE erp_banco_contas SET saldo_atual=saldo_atual - v_valor WHERE id=p_banco_conta_id;
        END IF;
        INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
        VALUES (v_company, v_autor, v_email, 'erp_pagar', v_id::text, 'batch_baixa', NULL,
                jsonb_build_object('status','pago','data_pagamento',p_data_pagamento,
                                   'forma_pagamento',p_forma_pagamento,'banco_conta_id',p_banco_conta_id));
      ELSE
        UPDATE erp_receber
           SET status='pago', data_pagamento=p_data_pagamento, valor_pago=valor,
               forma_pagamento=COALESCE(p_forma_pagamento, forma_pagamento),
               conta_bancaria=COALESCE(p_banco_conta_id::text, conta_bancaria), updated_at=NOW()
         WHERE id=v_id AND status<>'cancelado' RETURNING valor, company_id INTO v_valor, v_company;
        IF FOUND THEN
          v_found := true;
          IF p_banco_conta_id IS NOT NULL THEN
            UPDATE erp_banco_contas SET saldo_atual=saldo_atual + v_valor WHERE id=p_banco_conta_id;
          END IF;
          INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
          VALUES (v_company, v_autor, v_email, 'erp_receber', v_id::text, 'batch_baixa', NULL,
                  jsonb_build_object('status','pago','data_pagamento',p_data_pagamento,
                                     'forma_pagamento',p_forma_pagamento,'banco_conta_id',p_banco_conta_id));
        END IF;
      END IF;
      IF v_found THEN v_ok := v_ok + 1; ELSE v_err := v_err + 1; END IF;
    EXCEPTION WHEN OTHERS THEN v_err := v_err + 1;
    END;
  END LOOP;
  RETURN QUERY SELECT v_proc, v_ok, v_err,
    format('%s titulos processados: %s sucesso, %s erros', v_proc, v_ok, v_err)::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.batch_cancelar_titulos(
  p_lancamento_ids uuid[],
  p_motivo text DEFAULT 'Cancelamento em lote'::text,
  p_usuario_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(total_processados integer, total_sucesso integer, mensagem text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n1 INT := 0; v_n2 INT := 0;
  v_obs TEXT := E'\n[CANCELADO] ' || p_motivo || ' em ' || TO_CHAR(NOW(), 'DD/MM/YYYY HH24:MI');
  v_autor UUID := COALESCE(auth.uid(), p_usuario_id);
  v_email TEXT := (SELECT email FROM users WHERE id = COALESCE(auth.uid(), p_usuario_id));
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR auth.role()='service_role' OR is_admin()) THEN
    IF EXISTS (
      SELECT 1 FROM erp_pagar   WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
      UNION ALL
      SELECT 1 FROM erp_receber WHERE id = ANY(p_lancamento_ids) AND (company_id IS NULL OR company_id NOT IN (SELECT get_user_company_ids()))
    ) THEN RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501'; END IF;
  END IF;

  WITH upd AS (
    UPDATE erp_pagar SET status='cancelado', observacoes=COALESCE(observacoes,'')||v_obs, updated_at=NOW()
     WHERE id = ANY(p_lancamento_ids) AND status<>'cancelado'
    RETURNING id, company_id
  )
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  SELECT company_id, v_autor, v_email, 'erp_pagar', id::text, 'batch_cancelar', NULL,
         jsonb_build_object('status','cancelado','motivo',p_motivo)
    FROM upd;
  GET DIAGNOSTICS v_n1 = ROW_COUNT;

  WITH upd AS (
    UPDATE erp_receber SET status='cancelado', observacoes=COALESCE(observacoes,'')||v_obs, updated_at=NOW()
     WHERE id = ANY(p_lancamento_ids) AND status<>'cancelado'
    RETURNING id, company_id
  )
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  SELECT company_id, v_autor, v_email, 'erp_receber', id::text, 'batch_cancelar', NULL,
         jsonb_build_object('status','cancelado','motivo',p_motivo)
    FROM upd;
  GET DIAGNOSTICS v_n2 = ROW_COUNT;

  RETURN QUERY SELECT array_length(p_lancamento_ids, 1), (v_n1 + v_n2), format('%s titulos cancelados', v_n1 + v_n2)::TEXT;
END;
$function$;
