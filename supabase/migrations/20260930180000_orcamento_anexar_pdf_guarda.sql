-- Tryo #264 · fn_orcamento_anexar_pdf nunca funcionou: a guarda usava `v_company = ANY (public.get_user_company_ids())`,
-- mas get_user_company_ids() devolve SETOF uuid (não array) e o Postgres recusa em toda chamada
-- ("op ANY/ALL (array) requires array on right side", 42809). Por isso o botão "anexar PDF" do orçamento salvo
-- (CRM ②, 17/09) falhava sempre e a Tryo tem 0 PDF. Provado em produção, como o robô, em transação desfeita.
-- Correção: mesma guarda no padrão do resto do banco (IN (SELECT ...)); o resto da função fica igual.
-- Varredura: é a única função pública com esse padrão (pg_proc.prosrc).

CREATE OR REPLACE FUNCTION public.fn_orcamento_anexar_pdf(
  p_orcamento_id uuid, p_path text DEFAULT NULL, p_valor numeric DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_uid uuid := auth.uid();
BEGIN
  SELECT company_id INTO v_company FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'orcamento_nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE erp_orcamentos SET
    pdf_anexo_path = p_path,
    pdf_anexo_em   = CASE WHEN p_path IS NULL THEN NULL ELSE now() END,
    pdf_anexo_por  = CASE WHEN p_path IS NULL THEN NULL ELSE v_uid END,
    total          = COALESCE(p_valor, total),
    updated_at     = now()
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object('ok', true, 'orcamento_id', p_orcamento_id,
    'pdf_anexo_path', p_path, 'total', (SELECT total FROM erp_orcamentos WHERE id = p_orcamento_id));
END $function$;

REVOKE ALL ON FUNCTION public.fn_orcamento_anexar_pdf(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_anexar_pdf(uuid, text, numeric) TO authenticated;
