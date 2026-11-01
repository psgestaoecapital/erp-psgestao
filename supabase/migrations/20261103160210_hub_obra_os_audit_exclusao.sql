-- Hub · /dashboard/projetos/obras/os · RD-98 p4 — fecha o único gap da nota 93→≥95.
-- fn_obra_os_excluir já faz soft-delete com rastro de quem/quando (excluido_em/excluido_por),
-- mas NÃO grava auditoria em audit_log_global. Esta migration é ADITIVA: acrescenta o registro
-- de auditoria antes do soft-delete, mantendo assinatura, guarda de empresa e comportamento.

CREATE OR REPLACE FUNCTION public.fn_obra_os_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid; v_obra uuid; v_numero text; v_descricao text; v_status text;
  v_uid uuid := auth.uid();
BEGIN
  SELECT company_id, obra_id, numero, descricao, status
    INTO v_company, v_obra, v_numero, v_descricao, v_status
    FROM public.projetos_obra_os WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);

  -- RD-98 p4: rastro de quem/quando excluiu + estado anterior da OS.
  INSERT INTO audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
     'projetos_obra_os', p_id::text, 'obra_os_excluida',
     jsonb_build_object('obra_id', v_obra, 'numero', v_numero, 'descricao', v_descricao, 'status', v_status),
     jsonb_build_object('excluido', true, 'excluido_por', v_uid));

  UPDATE public.projetos_obra_os SET excluido_em = now(), excluido_por = v_uid WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Guarda de função SECURITY DEFINER (check_fn_guards · regra 1 · revoke_anon): fecha IDOR via anon/PUBLIC.
REVOKE ALL ON FUNCTION public.fn_obra_os_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_excluir(uuid) TO authenticated, service_role;
