-- #728 · Cancelamento (perda) vive no orçamento.
-- O pedido não-faturado volta a orçamento (fn_pedido_reverter_para_orcamento) e o cancelamento acontece aqui.
-- Sem estorno: orçamento não tem título nem estoque. Reaproveita erp_motivo_perda (company_id + ativo +
-- exige_descricao), o mesmo cadastro que fn_pedido_cancelar usa, e registra em erp_orcamento_historico.

CREATE OR REPLACE FUNCTION public.fn_orcamento_cancelar(p_orcamento_id uuid, p_motivo_perda_id uuid, p_motivo_texto text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_orc record; v_exige boolean;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  SELECT * INTO v_orc FROM public.erp_orcamentos WHERE id = p_orcamento_id;
  IF v_orc IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_orc.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  IF v_orc.status = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento já cancelado'); END IF;
  -- Convertido = existe pedido vivo: cancele/reverta o pedido primeiro (o pedido é a entidade ativa).
  IF v_orc.status = 'convertido' OR v_orc.pedido_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento convertido em pedido — reverta o pedido antes de cancelar.'); END IF;

  IF p_motivo_perda_id IS NULL THEN RAISE EXCEPTION 'Escolha o motivo da perda.'; END IF;
  SELECT exige_descricao INTO v_exige FROM public.erp_motivo_perda
    WHERE id = p_motivo_perda_id AND company_id = v_orc.company_id AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Motivo de perda inválido para esta empresa.'; END IF;
  IF v_exige AND COALESCE(btrim(p_motivo_texto),'') = '' THEN
    RAISE EXCEPTION 'Este motivo exige uma descrição — diga o que aconteceu.'; END IF;

  UPDATE public.erp_orcamentos
     SET status = 'cancelado', data_recusa = now(), updated_at = now()
   WHERE id = p_orcamento_id;

  INSERT INTO public.erp_orcamento_historico (orcamento_id, company_id, evento, detalhe, usuario_id, metadata)
  VALUES (p_orcamento_id, v_orc.company_id, 'cancelado',
    COALESCE(NULLIF(btrim(p_motivo_texto), ''), 'Cancelado (perda)'), auth.uid(),
    jsonb_build_object('motivo_perda_id', p_motivo_perda_id, 'motivo_texto', btrim(p_motivo_texto)));

  RETURN jsonb_build_object('ok', true, 'orcamento_id', p_orcamento_id, 'status', 'cancelado');
END $function$;

REVOKE ALL ON FUNCTION public.fn_orcamento_cancelar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_cancelar(uuid, uuid, text) TO authenticated, service_role;
