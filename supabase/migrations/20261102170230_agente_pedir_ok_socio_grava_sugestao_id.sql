-- [#5721] Pedido de OK do sócio não aparecia na tela do chamado: a mensagem ficava sem sugestao_id.
-- Ao pedir o OK, se a mensagem tem chamado_numero e não tem sugestao_id, grava o vínculo (idempotente).
CREATE OR REPLACE FUNCTION public.fn_agente_pedir_ok_socio(p_mensagem_id uuid, p_agente text, p_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; v_texto text := btrim(COALESCE(p_texto, '')); v_sug uuid;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT * INTO m FROM erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF m.para <> p_agente THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_de_outro_agente'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_agente_escopo WHERE agente = p_agente AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'agente_sem_socio'); END IF;
  IF m.status IN ('concluida','recusada') OR m.arquivada THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_encerrada'); END IF;
  IF v_texto = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'texto_vazio'); END IF;
  v_sug := m.sugestao_id;
  IF v_sug IS NULL AND m.chamado_numero IS NOT NULL THEN
    SELECT s.id INTO v_sug FROM sugestoes s WHERE s.numero = m.chamado_numero LIMIT 1;
  END IF;
  UPDATE erp_agente_mensagem
     SET pedido_ok_socio = v_texto, pedido_ok_socio_em = now(),
         ok_socio_decisao = NULL, ok_socio_em = NULL, ok_socio_por = NULL,
         sugestao_id = COALESCE(sugestao_id, v_sug), atualizado_em = now()
   WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true, 'id', p_mensagem_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_pedir_ok_socio(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agente_pedir_ok_socio(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_pedir_ok_socio(uuid, text, text) TO service_role;
