-- RD-98 p4 (exclusão/arquivamento rastreável) · /dashboard/produtividade/produtos
-- GAP (auditor): fn_prod_produto_arquivar fazia soft-delete (ativo=false) mas NÃO gravava
-- QUEM arquivou nem a trilha — só flipava a coluna. RD-98 p4 exige rastro do autor.
--
-- Correção (RD-26: reusa o MESMO padrão de fn_mao_obra_funcao_inativar — audit_log_global com
-- user_id=auth.uid(), ação arquivar/reativar, valor_anterior/valor_novo). Função aditiva por
-- CREATE OR REPLACE: mantém assinatura, guarda de empresa (fn_compliance_assert) e o shape do
-- retorno; passa a gravar updated_at e a trilha. Idempotente: só loga quando o estado muda.
-- Não faz DELETE físico, não toca RLS, não altera dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_prod_produto_arquivar(p_company_id uuid, p_id uuid, p_ativo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_nome text;
  v_antes boolean;
  v_novo boolean := coalesce(p_ativo, false);
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT nome, ativo INTO v_nome, v_antes
    FROM public.prod_produto
    WHERE id = p_id AND company_id = p_company_id
    FOR UPDATE;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;

  UPDATE public.prod_produto
    SET ativo = v_novo, updated_at = now()
    WHERE id = p_id AND company_id = p_company_id
    RETURNING id INTO v_id;

  -- RD-98 p4: trilha de exclusão/arquivamento (quem/quando) — só quando o estado muda (idempotente)
  IF v_antes IS DISTINCT FROM v_novo THEN
    INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
      VALUES (p_company_id, auth.uid(), 'prod_produto', p_id,
              CASE WHEN v_novo THEN 'reativar' ELSE 'arquivar' END,
              jsonb_build_object('ativo', v_antes, 'nome', v_nome),
              jsonb_build_object('ativo', v_novo, 'nome', v_nome));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ativo', v_novo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_produto_arquivar(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_arquivar(uuid, uuid, boolean) TO authenticated, service_role;
