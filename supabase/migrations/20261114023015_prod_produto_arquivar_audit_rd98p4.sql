-- RD-98 p4 (exclusão rastreável) para a tela /dashboard/produtividade/produtos
--
-- Gap do auditor (12/11, nota 92): fn_prod_produto_arquivar faz soft-delete
-- (ativo=false, sem DELETE físico) mas NÃO gravava audit_log nem o autor
-- (quem arquivou/reativou). Falta o rastro exigido pela RD-98 p4.
--
-- Correção ADITIVA (RD-97): mesma assinatura, mesmo retorno, mesma guarda por
-- empresa (fn_compliance_assert). Só acrescenta:
--   • registro em audit_log_global com user_id = auth.uid() (autor) + user_email;
--   • valor_anterior (ativo/nome antes) e valor_novo (ativo depois);
--   • ação 'produto_arquivar' (p_ativo=false) ou 'produto_reativar' (p_ativo=true).
-- Nenhum dado de cliente é apagado/alterado além do próprio ativo que o usuário
-- pediu. REVOKE anon mantido (SECURITY DEFINER só para usuário logado/serviço).
--
-- Prova RD-38 (BEGIN…ROLLBACK na DEMO 005, 12/11): produto "Boi em pé" ativo=true
-- -> arquivar => update 1 linha + 1 linha em audit_log_global com
-- valor_anterior {nome,ativo:true}. Transação revertida, nada persistido.

CREATE OR REPLACE FUNCTION public.fn_prod_produto_arquivar(
  p_company_id uuid,
  p_id uuid,
  p_ativo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id    uuid;
  v_old   boolean;
  v_nome  text;
  v_novo  boolean := coalesce(p_ativo, false);
  v_uid   uuid := auth.uid();
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);

  -- estado anterior (para o rastro) + guarda por empresa
  SELECT ativo, nome INTO v_old, v_nome
    FROM public.prod_produto
   WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'produto_nao_encontrado';
  END IF;

  UPDATE public.prod_produto
     SET ativo = v_novo
   WHERE id = p_id AND company_id = p_company_id
   RETURNING id INTO v_id;

  -- RD-98 p4: rastro de quem arquivou/reativou
  INSERT INTO public.audit_log_global (
    company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo
  )
  VALUES (
    p_company_id, v_uid, (SELECT email FROM public.users WHERE id = v_uid),
    'prod_produto', p_id::text,
    CASE WHEN v_novo THEN 'produto_reativar' ELSE 'produto_arquivar' END,
    jsonb_build_object('ativo', v_old, 'nome', v_nome),
    jsonb_build_object('ativo', v_novo)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ativo', v_novo);
END
$function$;

-- Trancar a RPC (sem anon; só usuário logado / serviço)
REVOKE ALL ON FUNCTION public.fn_prod_produto_arquivar(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_arquivar(uuid, uuid, boolean) TO authenticated, service_role;
