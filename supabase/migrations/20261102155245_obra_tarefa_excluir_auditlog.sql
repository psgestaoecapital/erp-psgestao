-- PDCA Hub · /dashboard/projetos/obras/[id]/cronograma · aud8 93/95 · GAP único (RD-98 p4)
-- Code: desenvolvedor_4_g
--
-- fn_obra_tarefa_excluir faz soft-delete correto (excluido_em/excluido_por) e cascateia
-- nas dependências, MAS não gravava rastro em audit_log_global — a exclusão de tarefa do
-- cronograma ficava sem trilha de auditoria (RD-98 p4: exclusão rastreável incompleta).
--
-- CORREÇÃO: INSERT em audit_log_global no mesmo padrão de fn_pm_timesheet_excluir
-- (tabela='projetos_obra_tarefa', acao='excluir', valor_anterior/valor_novo com excluido_em).
--
-- Aditiva: apenas CREATE OR REPLACE da função; mantém SECURITY DEFINER, guarda por empresa
-- (fn__guarda_empresa) e search_path='public', inalterados. Sem DDL destrutivo, sem tocar
-- RLS/grants/dado de cliente além do próprio soft-delete já existente.

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_tarefa WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_tarefa SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  UPDATE public.projetos_obra_tarefa_dependencia SET excluido_em = now()
   WHERE (tarefa_id = p_id OR predecessora_id = p_id) AND excluido_em IS NULL;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'projetos_obra_tarefa', p_id, 'excluir',
            jsonb_build_object('excluido_em', NULL),
            jsonb_build_object('excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Guarda check_fn_guards (regra 1 revoke_anon): REVOKE explícito idêntico à ACL viva.
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_excluir(uuid) TO authenticated, service_role;
