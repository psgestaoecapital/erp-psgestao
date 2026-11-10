-- Núcleo · Cadastro de Clientes (/dashboard/clientes) · PDCA aud8claudeps 09/11 (65/95)
-- Gap que restava (a main já cobriu RD-95 "?" com as chaves ge.clientes.* e o erro amigável):
--   RD-98 p2/p4 — Excluir (arquivar) e Restaurar o cliente, com rastro, sem DELETE físico.
-- fn_cliente_arquivar já existe na main; aqui entra o PAR que faltava (restaurar) + a origem do dado (p3).
-- ADITIVA, idempotente, não altera dado de cliente. Faixa do code-desenvolvedor-3 (segundos :37), acima da main.

-- 1) Restaurar cliente arquivado (soft-undelete rastreável) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cliente_restaurar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para restaurar'); END IF;
  SELECT company_id, COALESCE(NULLIF(nome_fantasia,''), razao_social)
    INTO v_company, v_nome
    FROM public.erp_clientes WHERE id = p_id AND excluido_em IS NOT NULL FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cliente não encontrado ou não está excluído'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_clientes
     SET ativo = true, excluido_em = NULL, excluido_por = NULL, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_clientes', p_id, 'restaurar',
            jsonb_build_object('ativo', false, 'excluido', true),
            jsonb_build_object('ativo', true, 'nome', v_nome, 'restaurado_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_cliente_restaurar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cliente_restaurar(uuid) TO authenticated;

-- 2) RD-98 p3 · origem do dado da tela ─────────────────────────────────────────────────────────
UPDATE public.system_screens
   SET views_consumidas = ARRAY['erp_clientes']::text[],
       rpcs_chamadas   = ARRAY['fn_cliente_arquivar','fn_cliente_restaurar','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/clientes';
