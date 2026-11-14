-- Chamado #6730 (Tryo) · "QUANDO ANEXAR O ORÇAMENTO ALTERAR AUTOMATICAMENTE O STATUS PARA APROVAÇÃO".
-- Parte 1 (valor fica salvo) já estava resolvida. Parte 2: ao ANEXAR o PDF do orçamento feito
-- fora do sistema, o orçamento em rascunho vai automaticamente para "enviado" (status de aprovação
-- válido no CHECK chk_orcamentos_status) e ganha o hash público (link do cliente), igual ao botão
-- "Enviar". Aditiva e segura:
--   * só promove quando está em 'rascunho' — NUNCA rebaixa orçamento já enviado/aprovado/convertido;
--   * remover o PDF (p_path NULL) não mexe no status;
--   * 'enviado' não dispara o trigger de gerar obra (só 'aprovado'/'convertido');
--   * mesmo contrato de retorno + novo campo 'status' informativo.
CREATE OR REPLACE FUNCTION public.fn_orcamento_anexar_pdf(p_orcamento_id uuid, p_path text DEFAULT NULL::text, p_valor numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_uid uuid := auth.uid();
  v_status_atual text;
  v_novo_status text;
  v_hash text;
BEGIN
  SELECT company_id, status, hash_publico
    INTO v_company, v_status_atual, v_hash
    FROM erp_orcamentos WHERE id = p_orcamento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'orcamento_nao_encontrado'); END IF;
  IF v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- #6730 · anexar o PDF manda o orçamento para aprovação (rascunho -> enviado).
  v_novo_status := v_status_atual;
  IF p_path IS NOT NULL AND v_status_atual = 'rascunho' THEN
    v_novo_status := 'enviado';
    IF v_hash IS NULL OR v_hash = '' THEN
      v_hash := replace(gen_random_uuid()::text, '-', '');  -- 32 hex, cabe em varchar(32)
    END IF;
  END IF;

  UPDATE erp_orcamentos SET
    pdf_anexo_path = p_path,
    pdf_anexo_em   = CASE WHEN p_path IS NULL THEN NULL ELSE now() END,
    pdf_anexo_por  = CASE WHEN p_path IS NULL THEN NULL ELSE v_uid END,
    total          = COALESCE(p_valor, total),
    status         = v_novo_status,
    hash_publico   = v_hash,
    updated_at     = now()
  WHERE id = p_orcamento_id;

  -- Rastro no histórico do orçamento (RD-98) quando a promoção acontecer.
  IF v_novo_status IS DISTINCT FROM v_status_atual THEN
    INSERT INTO erp_orcamento_historico(orcamento_id, company_id, evento, detalhe)
    VALUES (p_orcamento_id, v_company, 'status_enviado',
            'PDF anexado — orçamento enviado para aprovação automaticamente');
  END IF;

  RETURN jsonb_build_object('ok', true, 'orcamento_id', p_orcamento_id,
    'pdf_anexo_path', p_path, 'status', v_novo_status,
    'total', (SELECT total FROM erp_orcamentos WHERE id = p_orcamento_id));
END $function$;

-- ACL (sem anon): rede de segurança estática do check_fn_guards.
REVOKE ALL ON FUNCTION public.fn_orcamento_anexar_pdf(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_anexar_pdf(uuid, text, numeric) TO authenticated, service_role;
