-- PDCA Hub · /dashboard/projetos/viagens — RD-98 p4 (exclusão rastreável): fn_viagem_excluir e
-- fn_viagem_lancamento_excluir já faziam soft-delete (excluido_em/excluido_por) + guarda por empresa,
-- mas NÃO gravavam audit_log_global. Esta migration só ACRESCENTA o INSERT no audit_log em cada uma
-- (CREATE OR REPLACE do corpo VIVO + a linha de auditoria). Não muda a regra de exclusão, os guards,
-- nem toca financeiro (as funções não escrevem em erp_pagar). Idempotente por natureza (redefinição).

CREATE OR REPLACE FUNCTION public.fn_viagem_excluir(p_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE v_v public.erp_viagem%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF NOT public.fn_viagem_pode_gravar(v_v.company_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Perfil de consulta não altera viagens'); END IF;
  IF v_v.status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só é possível excluir viagem aberta. Viagem fechada não se exclui.'); END IF;
  IF EXISTS (SELECT 1 FROM public.erp_viagem_ge_titulo WHERE viagem_id = p_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Viagem já lançada no GE não pode ser excluída');
  END IF;
  UPDATE public.erp_viagem SET excluido_em = now(), excluido_por = auth.uid(), atualizado_em = now() WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_v.company_id, auth.uid(), 'erp_viagem', p_id::text, 'excluir',
            jsonb_build_object('status', v_v.status), jsonb_build_object('excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_viagem_lancamento_excluir(p_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE v_l public.erp_viagem_lancamento%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO v_l FROM public.erp_viagem_lancamento WHERE id = p_id;
  IF NOT FOUND OR v_l.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_l.company_id);
  SELECT status INTO v_status FROM public.erp_viagem WHERE id = v_l.viagem_id;
  IF v_status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não se altera'); END IF;
  UPDATE public.erp_viagem_lancamento SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_l.company_id, auth.uid(), 'erp_viagem_lancamento', p_id::text, 'excluir',
            jsonb_build_object('viagem_id', v_l.viagem_id), jsonb_build_object('excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Guarda RD-52/segurança: ambas SECURITY DEFINER — fecha chamada direta por anon (check-fn-guards).
REVOKE ALL ON FUNCTION public.fn_viagem_excluir(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_viagem_lancamento_excluir(uuid) FROM anon;
