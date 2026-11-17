-- fn_pessoa_set_ativo: writer guardado para inativar/reativar cliente ou fornecedor com trilho de auditoria.
-- PDCA GE /dashboard/cadastros/clientes e /fornecedores (PessoasList compartilhado):
--   RD-98 p4 — inativar/reativar faziam UPDATE ativo direto no client, SEM registrar quem/quando.
-- Esta RPC centraliza o flip de `ativo`: valida RLS/multi-tenant, é idempotente e grava audit_log_global
-- (acao cliente_inativar/cliente_reativar/fornecedor_inativar/fornecedor_reativar). NÃO apaga nem altera
-- outro dado do cliente — só o campo ativo (soft-delete reversível, como hoje). Aditiva (só cria a função).

CREATE OR REPLACE FUNCTION public.fn_pessoa_set_ativo(
  p_tipo  text,
  p_id    uuid,
  p_ativo boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_comp   uuid;
  v_ativo  boolean;
  v_nome   text;
  v_doc    text;
  v_tab    text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;
  IF p_tipo NOT IN ('cliente', 'fornecedor') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido');
  END IF;
  IF p_id IS NULL OR p_ativo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'parametros_invalidos');
  END IF;

  -- Lê a linha na tabela certa (branches estáticos: sem SQL dinâmico).
  IF p_tipo = 'cliente' THEN
    v_tab := 'erp_clientes';
    SELECT company_id, ativo, COALESCE(nome_fantasia, razao_social), cnpj_cpf
      INTO v_comp, v_ativo, v_nome, v_doc
      FROM public.erp_clientes WHERE id = p_id;
  ELSE
    v_tab := 'erp_fornecedores';
    SELECT company_id, ativo, COALESCE(nome_fantasia, razao_social), cnpj_cpf
      INTO v_comp, v_ativo, v_nome, v_doc
      FROM public.erp_fornecedores WHERE id = p_id;
  END IF;

  IF v_comp IS NULL AND v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  -- Guarda multi-tenant: só age em registro de empresa no escopo do usuário (ou admin).
  IF NOT (v_comp IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- Idempotente: mesmo estado não grava nem gera ruído no audit.
  IF v_ativo IS NOT DISTINCT FROM p_ativo THEN
    RETURN jsonb_build_object('ok', true, 'inalterado', true, 'ativo', p_ativo);
  END IF;

  IF p_tipo = 'cliente' THEN
    UPDATE public.erp_clientes SET ativo = p_ativo WHERE id = p_id;
  ELSE
    UPDATE public.erp_fornecedores SET ativo = p_ativo WHERE id = p_id;
  END IF;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (v_comp, v_uid, COALESCE((SELECT email FROM public.users WHERE id = v_uid), ''),
     v_tab, p_id::text,
     p_tipo || CASE WHEN p_ativo THEN '_reativar' ELSE '_inativar' END,
     jsonb_build_object('ativo', v_ativo, 'nome', v_nome, 'cnpj_cpf', v_doc),
     jsonb_build_object('ativo', p_ativo));

  RETURN jsonb_build_object('ok', true, 'ativo', p_ativo, 'nome', v_nome);
END $function$;

REVOKE ALL ON FUNCTION public.fn_pessoa_set_ativo(text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pessoa_set_ativo(text, uuid, boolean) TO authenticated;
