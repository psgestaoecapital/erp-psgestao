-- PDCA Hub · /dashboard/projetos/obras/os · RD-98 p4: RESTAURAÇÃO RASTREÁVEL no log
-- Gap (auditor_pdca_1 01/11, prova no banco): a #3682 passou a gravar audit_log_global
--   na fn_obra_os_excluir, mas a fn_obra_os_restaurar continua fazendo o soft-undelete
--   (excluido_em/excluido_por = NULL) SEM gravar em audit_log_global. A restauração de
--   uma OS da Lixeira não ficava rastreável no log global. Fecha o par do gap 1 da OS.
-- Correção: incluir INSERT em audit_log_global dentro da função (ação RESTAUROU,
--   valor_anterior/valor_novo), no mesmo padrão da fn_obra_os_excluir (#3682), em bloco
--   protegido para nunca quebrar a restauração caso o log falhe.
-- Aditiva: assinatura (uuid) INALTERADA; comportamento preservado (guarda de empresa,
--   validações). Nenhum dado de cliente alterado ou apagado.

CREATE OR REPLACE FUNCTION public.fn_obra_os_restaurar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_os public.projetos_obra_os%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema para restaurar a OS'; END IF;
  SELECT * INTO v_os FROM public.projetos_obra_os WHERE id = p_id FOR UPDATE;
  IF v_os.id IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  IF v_os.excluido_em IS NULL THEN RAISE EXCEPTION 'OS não está excluída'; END IF;
  PERFORM public.fn__guarda_empresa(v_os.company_id);

  UPDATE public.projetos_obra_os
     SET excluido_em = NULL, excluido_por = NULL, atualizado_em = now()
   WHERE id = p_id;

  BEGIN
    INSERT INTO public.audit_log_global
      (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES
      (v_os.company_id, auth.uid(), (SELECT email FROM public.users WHERE id = auth.uid()),
       'projetos_obra_os', v_os.id::text, 'RESTAUROU',
       jsonb_build_object('acao', 'estava_excluida', 'excluido_em', v_os.excluido_em,
                          'excluido_por', v_os.excluido_por),
       jsonb_build_object('numero', v_os.numero, 'descricao', v_os.descricao,
                          'status', v_os.status, 'obra_id', v_os.obra_id,
                          'responsavel', v_os.responsavel,
                          'restaurado_por', auth.uid()));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END $function$;

-- Reafirma a ACL da função SECURITY DEFINER (gate check-fn-guards / [revoke_anon]).
-- Espelha a ACL viva hoje ({authenticated, service_role}; sem anon/PUBLIC).
REVOKE ALL ON FUNCTION public.fn_obra_os_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_restaurar(uuid) TO authenticated, service_role;
