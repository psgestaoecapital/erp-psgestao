-- PDCA Hub · /dashboard/projetos/calculadora (aud8 90) — gap RD-98 p4
-- Exclusão rastreável: fn_calc_historico_excluir / fn_calc_historico_restaurar
-- passam a gravar em audit_log_global (acao EXCLUIU / RESTAUROU), com id/titulo e company_id.
-- Aditiva: NÃO altera o comportamento de soft-delete existente, só acrescenta o rastro de auditoria.
-- Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.fn_calc_historico_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.erp_calc_historico%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO v FROM public.erp_calc_historico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cálculo não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  UPDATE public.erp_calc_historico SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v.company_id, auth.uid(),
    (SELECT email FROM public.users WHERE id = auth.uid()),
    'erp_calc_historico', v.id::text, 'EXCLUIU',
    jsonb_build_object('titulo', v.titulo, 'sistema', v.sistema, 'preco_venda', v.preco_venda, 'excluido_em', NULL),
    jsonb_build_object('excluido_em', now())
  );

  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_calc_historico_restaurar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.erp_calc_historico%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para desfazer'); END IF;
  SELECT * INTO v FROM public.erp_calc_historico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.excluido_em IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cálculo não está excluído'); END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  IF v.excluido_por IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só quem excluiu pode desfazer'); END IF;
  IF v.excluido_em < now() - interval '15 minutes' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Passou o prazo de 15 minutos para desfazer'); END IF;
  UPDATE public.erp_calc_historico SET excluido_em = NULL, excluido_por = NULL WHERE id = p_id;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v.company_id, auth.uid(),
    (SELECT email FROM public.users WHERE id = auth.uid()),
    'erp_calc_historico', v.id::text, 'RESTAUROU',
    jsonb_build_object('titulo', v.titulo, 'sistema', v.sistema, 'excluido_em', v.excluido_em),
    jsonb_build_object('excluido_em', NULL)
  );

  RETURN jsonb_build_object('ok', true);
END $function$;

-- RD (check_fn_guards): declara explicitamente a ACL das funções SECURITY DEFINER.
-- CREATE OR REPLACE preserva a ACL viva (authenticated, service_role; sem anon/PUBLIC);
-- estes REVOKE/GRANT apenas tornam a declaração explícita — não mudam o comportamento.
REVOKE ALL ON FUNCTION public.fn_calc_historico_excluir(uuid)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_calc_historico_excluir(uuid)   TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_calc_historico_restaurar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_calc_historico_restaurar(uuid) TO authenticated, service_role;
