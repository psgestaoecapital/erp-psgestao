-- Cronograma da obra (PDCA Hub) — RD-98 p4: exclusão de tarefa rastreável.
-- fn_obra_tarefa_excluir fazia soft-delete (excluido_em/excluido_por) SEM registrar em
-- audit_log_global — a exclusão não ficava auditável. Alinha ao padrão de fn_obra_excluir:
-- grava o log numa sub-transação protegida (falha de log não derruba a exclusão).
-- Aditivo/idempotente: CREATE OR REPLACE, mesma assinatura e guarda de empresa.

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t public.projetos_obra_tarefa%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.projetos_obra_tarefa WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_t.company_id);
  UPDATE public.projetos_obra_tarefa SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  UPDATE public.projetos_obra_tarefa_dependencia SET excluido_em = now()
   WHERE (tarefa_id = p_id OR predecessora_id = p_id) AND excluido_em IS NULL;
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_t.company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()),
            'projetos_obra_tarefa', v_t.id::text, 'EXCLUIU',
            jsonb_build_object('nome', v_t.nome, 'inicio', v_t.inicio, 'fim', v_t.fim,
                               'percentual', v_t.percentual, 'obra_id', v_t.obra_id),
            jsonb_build_object('acao', 'soft_delete'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_tarefa_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_excluir(uuid) TO authenticated, service_role;
