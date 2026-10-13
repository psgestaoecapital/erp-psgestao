-- Central de Dev — aprovação do documento vivo (faltava o caminho; o SPEC dizia "o CEO aprova"
-- mas não havia RPC nem botão). Rascunho → aprovado, e caminho de volta (revogar).
-- Só PS_ADMIN humano (fn_eh_ps_admin). Ao aprovar, o documento vira a REFERÊNCIA da vertical.

CREATE OR REPLACE FUNCTION public.fn_dev_documento_aprovar(p_vertical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_status text; v_nome text;
BEGIN
  IF NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok',false,'mensagem','Apenas a equipe PS pode aprovar.');
  END IF;
  SELECT id, status INTO v_id, v_status FROM public.erp_documento_vertical WHERE vertical=p_vertical AND vigente;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'mensagem','Não há documento vigente para esta vertical.');
  END IF;
  IF v_status='aprovado' THEN
    RETURN jsonb_build_object('ok',true,'status','aprovado','sem_mudanca',true,'mensagem','Este documento já estava aprovado.');
  END IF;
  UPDATE public.erp_documento_vertical
     SET status='aprovado', aprovado_por=auth.uid(), aprovado_em=now()
   WHERE id=v_id;
  SELECT COALESCE(full_name,email) INTO v_nome FROM public.users WHERE id=auth.uid();
  RETURN jsonb_build_object('ok',true,'status','aprovado','aprovado_por_nome',v_nome,'mensagem','Documento aprovado. Passa a ser a referência da vertical.');
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_dev_documento_aprovar(text) TO authenticated, service_role;

-- Caminho de volta: revogar a aprovação (volta a rascunho). Nova versão continua entrando como
-- rascunho pelo fluxo do documento vivo (a anterior perde vigente).
CREATE OR REPLACE FUNCTION public.fn_dev_documento_desaprovar(p_vertical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_status text;
BEGIN
  IF NOT public.fn_eh_ps_admin() THEN
    RETURN jsonb_build_object('ok',false,'mensagem','Apenas a equipe PS pode revogar.');
  END IF;
  SELECT id, status INTO v_id, v_status FROM public.erp_documento_vertical WHERE vertical=p_vertical AND vigente;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'mensagem','Não há documento vigente para esta vertical.');
  END IF;
  IF v_status <> 'aprovado' THEN
    RETURN jsonb_build_object('ok',true,'status',v_status,'sem_mudanca',true,'mensagem','Este documento não está aprovado.');
  END IF;
  UPDATE public.erp_documento_vertical
     SET status='rascunho', aprovado_por=NULL, aprovado_em=NULL
   WHERE id=v_id;
  RETURN jsonb_build_object('ok',true,'status','rascunho','mensagem','Aprovação revogada. Voltou a rascunho.');
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_dev_documento_desaprovar(text) TO authenticated, service_role;
