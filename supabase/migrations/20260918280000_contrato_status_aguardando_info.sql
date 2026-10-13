-- #59 PDOIS parte 2 · CORREÇÃO de descuido do #1549: erp_contratos.status é varchar(20), mas o CHECK
-- do #1549 admitia 'aguardando_informacoes' (22 chars). A transição para esse status estourava
-- "value too long for type character varying(20)" em produção — a fila "Aguardando informações" não
-- funcionava. Alargar a coluna exigiria recriar uma cadeia de views (v_contratos_dashboard, _mrr_por_tipo,
-- _top_clientes, _receita_projetada_12m, _receita_projetada_resumo_mensal, …) — risco alto no dashboard
-- do CEO. Correção contida: o código do status vira 'aguardando_info' (15 chars, cabe em varchar(20));
-- o rótulo exibido continua "Aguardando informações". Só o vocabulário interno deste fluxo muda.
-- Idempotente. Sem tocar em views.

-- 1) CHECK: troca 'aguardando_informacoes' por 'aguardando_info' na lista de status.
ALTER TABLE public.erp_contratos DROP CONSTRAINT IF EXISTS erp_contratos_status_check2;
ALTER TABLE public.erp_contratos ADD CONSTRAINT erp_contratos_status_check2
  CHECK (status IS NULL OR (status)::text = ANY (ARRAY[
    'solicitado','em_elaboracao','aguardando_info','em_revisao','aguardando_aprovacao',
    'ativo','cancelado','suspenso','encerrado','excluido']::text[]));

-- 2) fn_contrato_mudar_status: usa 'aguardando_info' (na lista de válidos e na exigência de mensagem).
--    Corpo idêntico ao #1549, só o token do status muda. (Guarda de empresa e gerador preservados.)
CREATE OR REPLACE FUNCTION public.fn_contrato_mudar_status(p_contrato_id uuid, p_status text, p_mensagem text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_c record; v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
  v_uid uuid := auth.uid(); v_n_arq int; v_soma numeric; v_ger jsonb;
  v_validos text[] := ARRAY['solicitado','em_elaboracao','aguardando_info','em_revisao','aguardando_aprovacao','ativo','cancelado','suspenso','encerrado'];
BEGIN
  SELECT * INTO v_c FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','contrato_nao_encontrado'); END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  IF NOT (p_status = ANY(v_validos)) THEN RETURN jsonb_build_object('ok',false,'erro','status_invalido'); END IF;
  IF p_status = 'aguardando_info' AND COALESCE(btrim(p_mensagem),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'erro','mensagem_obrigatoria'); END IF;

  IF p_status = 'ativo' THEN
    SELECT count(*) INTO v_n_arq FROM erp_contratos_arquivos WHERE contrato_id = p_contrato_id AND tipo IN ('contrato','contrato_assinado');
    IF v_n_arq < 1 THEN RETURN jsonb_build_object('ok',false,'erro','anexo_contrato_obrigatorio'); END IF;
    SELECT COALESCE(SUM(valor),0) INTO v_soma FROM erp_contrato_parcelas WHERE contrato_id = p_contrato_id;
    IF v_soma <= 0 THEN RETURN jsonb_build_object('ok',false,'erro','plano_sem_valor'); END IF;
  END IF;

  UPDATE erp_contratos SET status = p_status, updated_at = now() WHERE id = p_contrato_id;
  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_contrato_id, v_c.company_id, 'status_'||p_status,
    COALESCE(NULLIF(btrim(p_mensagem),''), format('Status alterado de %s para %s', v_c.status, p_status)),
    jsonb_build_object('de', v_c.status, 'para', p_status), v_uid, now());

  IF p_status = 'ativo' THEN v_ger := fn_contrato_gerar_parcelas(p_contrato_id); END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'gerador', v_ger);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_contrato_mudar_status(uuid, text, text) TO authenticated, service_role;
