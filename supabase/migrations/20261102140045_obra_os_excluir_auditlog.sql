-- PDCA Hub · /dashboard/projetos/obras/os · RD-98 p4: EXCLUSÃO RASTREÁVEL no log
-- Gap (aud8claudeps 31/10, prova no banco): fn_obra_os_excluir já faz soft-delete
--   (excluido_em) + excluido_por = auth.uid(), mas NÃO grava em audit_log_global e não
--   há trigger de auditoria em projetos_obra_os. A exclusão de OS não ficava rastreável
--   no log global. Correção: incluir INSERT em audit_log_global dentro da função, no
--   mesmo padrão de fn_obra_excluir (ação EXCLUIU, valor_anterior/valor_novo), em bloco
--   protegido para nunca quebrar a exclusão caso o log falhe.
-- Aditiva: assinatura (uuid) INALTERADA; comportamento preservado (soft-delete + guarda
--   de empresa). Nenhum dado de cliente alterado ou apagado.

CREATE OR REPLACE FUNCTION public.fn_obra_os_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_os public.projetos_obra_os%ROWTYPE;
BEGIN
  SELECT * INTO v_os FROM public.projetos_obra_os WHERE id = p_id AND excluido_em IS NULL;
  IF v_os.id IS NULL THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_os.company_id);

  UPDATE public.projetos_obra_os
     SET excluido_em = now(), excluido_por = auth.uid()
   WHERE id = p_id;

  BEGIN
    INSERT INTO public.audit_log_global
      (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES
      (v_os.company_id, auth.uid(), (SELECT email FROM public.users WHERE id = auth.uid()),
       'projetos_obra_os', v_os.id::text, 'EXCLUIU',
       jsonb_build_object('numero', v_os.numero, 'descricao', v_os.descricao,
                          'status', v_os.status, 'obra_id', v_os.obra_id,
                          'responsavel', v_os.responsavel),
       jsonb_build_object('acao', 'soft_delete', 'excluido_por', auth.uid()));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END $function$;

-- Reafirma a ACL da função SECURITY DEFINER (gate check-fn-guards / [revoke_anon]).
-- Espelha a ACL viva hoje ({authenticated, service_role}; sem anon/PUBLIC).
REVOKE ALL ON FUNCTION public.fn_obra_os_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_os_excluir(uuid) TO authenticated, service_role;
