-- RD-98 p4 · Commerce › Fichas técnicas: exclusão RASTREÁVEL.
-- fn_ficha_tecnica_excluir / fn_ficha_item_excluir faziam DELETE físico sem gravar quem excluiu
-- nem o conteúdo removido. Aqui a exclusão passa a registrar, ANTES do DELETE, a linha completa e
-- o autor em audit_log_global (acao='excluir'). Semântica do DELETE inalterada (sem mudança nos
-- leitores): só acrescenta a trilha de auditoria. Soft-delete completo (recuperável) fica como
-- evolução futura, pois exigiria filtrar excluido_em em todos os leitores das duas tabelas.

CREATE OR REPLACE FUNCTION public.fn_ficha_tecnica_excluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_uid uuid := auth.uid(); v_old jsonb;
BEGIN
  SELECT to_jsonb(ft.*), ft.company_id INTO v_old, v_company
    FROM public.fichas_tecnicas ft WHERE ft.id = p_id;
  IF v_company IS NULL THEN
    RETURN; -- já não existe: idempotente
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'fichas_tecnicas', p_id::text, 'excluir', v_old);
  DELETE FROM public.fichas_tecnicas WHERE id = p_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_ficha_item_excluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_uid uuid := auth.uid(); v_old jsonb;
BEGIN
  SELECT to_jsonb(fi.*), ft.company_id INTO v_old, v_company
    FROM public.ficha_itens fi
    JOIN public.fichas_tecnicas ft ON ft.id = fi.ficha_id
   WHERE fi.id = p_id;
  IF v_company IS NULL THEN
    RETURN; -- já não existe: idempotente
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_company, v_uid, (SELECT email FROM users WHERE id = v_uid),
          'ficha_itens', p_id::text, 'excluir', v_old);
  DELETE FROM public.ficha_itens WHERE id = p_id;
END
$function$;
