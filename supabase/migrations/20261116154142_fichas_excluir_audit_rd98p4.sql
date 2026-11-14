-- PDCA commerce/fichas · RD-98 p4: exclusão de ficha e de item passa a gravar TRILHO no audit_log_global.
-- Agente code-desenvolvedor-3 (faixa de segundos :35–:44).
-- ADITIVO: só substitui a definição das 2 funções já existentes (mesma assinatura e retorno void),
-- inserindo o registro de auditoria ANTES do DELETE físico que a tela já faz. A migration não roda
-- nenhum DELETE/UPDATE em dado de cliente; apenas redefine as funções. Guarda de empresa preservada.

-- Exclusão de ficha técnica: loga quem/quando/o quê antes de apagar.
CREATE OR REPLACE FUNCTION public.fn_ficha_tecnica_excluir(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_ficha   public.fichas_tecnicas%ROWTYPE;
BEGIN
  SELECT * INTO v_ficha FROM public.fichas_tecnicas WHERE id = p_id;
  IF v_ficha.id IS NULL THEN
    RETURN; -- já não existe: idempotente
  END IF;
  v_company := v_ficha.company_id;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v_company, auth.uid(), 'fichas_tecnicas', p_id::text, 'EXCLUSAO',
    jsonb_build_object(
      'codigo', v_ficha.codigo,
      'nome', v_ficha.nome,
      'categoria', v_ficha.categoria,
      'unidade', v_ficha.unidade
    ),
    NULL
  );

  DELETE FROM public.fichas_tecnicas WHERE id = p_id;
END
$function$;

-- Exclusão de item da ficha: loga antes de apagar.
CREATE OR REPLACE FUNCTION public.fn_ficha_item_excluir(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_item    public.ficha_itens%ROWTYPE;
BEGIN
  SELECT fi.* INTO v_item FROM public.ficha_itens fi WHERE fi.id = p_id;
  IF v_item.id IS NULL THEN
    RETURN; -- já não existe: idempotente
  END IF;
  SELECT ft.company_id INTO v_company
    FROM public.fichas_tecnicas ft WHERE ft.id = v_item.ficha_id;
  IF v_company IS NULL OR NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (
    v_company, auth.uid(), 'ficha_itens', p_id::text, 'EXCLUSAO',
    to_jsonb(v_item) - 'company_id',
    NULL
  );

  DELETE FROM public.ficha_itens WHERE id = p_id;
END
$function$;

-- Guarda de acesso (régua 1 / check-fn-guards): função SECURITY DEFINER não é chamável por anônimo.
-- ACL idêntica à viva em produção (authenticated, service_role).
REVOKE ALL ON FUNCTION public.fn_ficha_tecnica_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_tecnica_excluir(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_ficha_item_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_item_excluir(uuid) TO authenticated, service_role;
