-- PDCA Hub · /dashboard/projetos/calculadora · RD-98 p4 (exclusão/restauração rastreável)
-- fn_calc_historico_restaurar desfaz o soft-delete (excluido_em -> NULL) mas NÃO gravava
-- na trilha central audit_log_global. O par fn_calc_historico_excluir já passou a gravar
-- (PR #3765). Esta migration fecha a outra metade: a restauração também fica rastreável.
-- Aditiva/segura: mantém assinatura e todas as travas (auth, guarda de empresa, só quem
-- excluiu, prazo de 15 min); só acrescenta UM INSERT em audit_log_global com acao 'restaurar'.
-- Code: code-desenvolvedor-3

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

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v.company_id, auth.uid(), 'erp_calc_historico', p_id, 'restaurar',
            jsonb_build_object('excluido_em', v.excluido_em),
            jsonb_build_object('excluido_em', NULL));

  RETURN jsonb_build_object('ok', true);
END $function$;

-- ACL (gate check_fn_guards / regra revoke_anon): função SECURITY DEFINER em migration nova
-- reafirma a ACL viva no próprio arquivo (EXECUTE só authenticated + service_role; anon/PUBLIC fora).
REVOKE ALL ON FUNCTION public.fn_calc_historico_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_calc_historico_restaurar(uuid) TO authenticated, service_role;
