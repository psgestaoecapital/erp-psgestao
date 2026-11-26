-- #11475 · Consignação do veículo: persistir pela função (campos próprios), com guarda de empresa e evento 'edicao'.
-- Hoje a tela grava a consignação por UPDATE direto do cliente (sem rastro, e o save do detalhe não fecha o fluxo).
-- Esta função (padrão de fn_veic_atualizar_dados — que NÃO é tocada) grava consignado + consignante_nome/documento/
-- valor_combinado, registra o evento e devolve ok:false legível em vez de HTTP mudo. Aditiva/idempotente (RD-52).

CREATE OR REPLACE FUNCTION public.fn_veic_consignacao_salvar(
  p_veiculo_id uuid, p_consignado boolean, p_nome text, p_documento text, p_valor numeric, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_autor uuid := auth.uid(); v_doc text;
BEGIN
  SELECT company_id INTO v_company FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF p_consignado AND NULLIF(btrim(coalesce(p_nome, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio', 'campo', 'consignante_nome'); END IF;
  v_doc := NULLIF(regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'), '');
  IF v_doc IS NOT NULL AND length(v_doc) NOT IN (11, 14) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'documento_invalido', 'campo', 'consignante_documento'); END IF;
  IF p_valor IS NOT NULL AND p_valor < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido', 'campo', 'consignante_valor_combinado'); END IF;

  UPDATE veic_veiculo SET
    consignado                  = coalesce(p_consignado, false),
    consignante_nome            = CASE WHEN p_consignado THEN NULLIF(btrim(p_nome), '') ELSE NULL END,
    consignante_documento       = CASE WHEN p_consignado THEN v_doc ELSE NULL END,
    consignante_valor_combinado = CASE WHEN p_consignado THEN p_valor ELSE NULL END,
    updated_by = v_autor, updated_at = now()
  WHERE id = p_veiculo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_company, p_veiculo_id, 'edicao',
          CASE WHEN p_consignado THEN 'Consignação do veículo salva' ELSE 'Consignação removida' END,
          v_autor, jsonb_build_object('consignado', coalesce(p_consignado, false)));

  RETURN jsonb_build_object('ok', true, 'consignado', coalesce(p_consignado, false));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'erro', 'falha_ao_salvar', 'sqlstate', SQLSTATE, 'mensagem', SQLERRM);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_veic_consignacao_salvar(uuid, boolean, text, text, numeric, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_veic_consignacao_salvar(uuid, boolean, text, text, numeric, uuid) TO authenticated, service_role;
