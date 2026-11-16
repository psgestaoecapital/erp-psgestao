-- RD-98 p4 · Bloquear/Desbloquear cliente via RPC GUARDADA (audit + multi-tenant), nunca UPDATE cru.
-- Auditor PDCA 2 (jornada GE, /dashboard/cadastros/clientes): a ação de bloquear cliente era um
-- UPDATE direto em erp_clientes vindo do navegador (sem auth.uid(), sem trilho de auditoria). Como
-- bloquear um cliente trava cobranças/vendas, é ação de dinheiro e precisa de rastro (quem/quando),
-- igual ao par arquivar/restaurar (fn_cliente_arquivar / fn_cliente_restaurar).
--
-- Aditiva: cria uma FUNÇÃO NOVA. Não altera dado de cliente nem a coluna (erp_clientes.bloqueado já
-- existe). Mesma guarda do par vivo: exige login, trava a linha, confere a empresa do usuário, grava
-- em audit_log_global. Idempotente no efeito (define o estado pedido) e re-rodável (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.fn_cliente_set_bloqueado(p_id uuid, p_bloqueado boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text; v_antes boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para bloquear/desbloquear');
  END IF;
  IF p_bloqueado IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe se é para bloquear ou desbloquear');
  END IF;
  SELECT company_id, COALESCE(NULLIF(nome_fantasia,''), razao_social), COALESCE(bloqueado, false)
    INTO v_company, v_nome, v_antes
    FROM public.erp_clientes WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Cliente não encontrado');
  END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- Nada a fazer se já está no estado pedido (não polui o trilho de auditoria).
  IF v_antes = p_bloqueado THEN
    RETURN jsonb_build_object('ok', true, 'bloqueado', p_bloqueado, 'inalterado', true);
  END IF;
  UPDATE public.erp_clientes
     SET bloqueado = p_bloqueado, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_clientes', p_id,
            CASE WHEN p_bloqueado THEN 'bloquear' ELSE 'desbloquear' END,
            jsonb_build_object('bloqueado', v_antes),
            jsonb_build_object('bloqueado', p_bloqueado, 'nome', v_nome));
  RETURN jsonb_build_object('ok', true, 'bloqueado', p_bloqueado);
END $function$;

REVOKE ALL ON FUNCTION public.fn_cliente_set_bloqueado(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cliente_set_bloqueado(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cliente_set_bloqueado(uuid, boolean) TO service_role;
