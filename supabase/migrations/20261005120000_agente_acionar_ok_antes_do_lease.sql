-- Correção do @pos-migration vermelho da #2014 (main 0caceb7): com a sessão real do gilberto-chamados ativa, o lease
-- vencia o motivo 'aguarda_ok_ceo' e o acionar devolvia 'sessao_ativa'. Agora o OK pendente é checado primeiro.
-- Só reordena os ramos de fn_agente_acionar (definição viva lida com pg_get_functiondef antes). Sem guardas (RD-91).

-- fn_agente_acionar: o OK do CEO pendente vale ANTES da trava de lease (resultado não depende de sessão ativa)
CREATE OR REPLACE FUNCTION public.fn_agente_acionar(p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m record; v_url text; v_token text; v_req bigint; v_res jsonb;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  SELECT msg.*, r.aciona INTO m
    FROM erp_agente_mensagem msg JOIN erp_agente_rotina r ON r.agente = msg.para
   WHERE msg.id = p_mensagem_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;

  IF m.requer_ok_ceo AND m.ok_ceo_em IS NULL THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'aguarda_ok_ceo');
  ELSIF public.fn__agente_lease_ativa(m.para) THEN
    -- sessão trabalhando: não dispara outra e não mexe na mensagem (não adia o despertador)
    RETURN jsonb_build_object('ok', true, 'em', now(), 'acionou', false, 'motivo', 'sessao_ativa');
  ELSIF NOT m.aciona THEN
    v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'agente_sem_acionamento');
  ELSE
    SELECT decrypted_secret INTO v_url   FROM vault.decrypted_secrets WHERE name = 'agente_rotina_url_'   || m.para;
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'agente_rotina_token_' || m.para;
    IF v_url IS NULL OR v_token IS NULL THEN
      v_res := jsonb_build_object('em', now(), 'acionou', false, 'motivo', 'rotina_nao_configurada_no_cofre');
    ELSE
      SELECT net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'Authorization',     'Bearer ' || v_token,
          'anthropic-beta',    'experimental-cc-routine-2026-04-01',
          'anthropic-version', '2023-06-01'),
        body    := jsonb_build_object('text',
          'Nova mensagem ' || m.id::text || ' na caixa de ' || m.para || ' (de ' || m.de || '). '
          || 'Leia pelo canal protegido: SELECT fn_agente_caixa(''' || m.para || ''');'),
        timeout_milliseconds := 15000
      ) INTO v_req;
      v_res := jsonb_build_object('em', now(), 'acionou', true, 'request_id', v_req);
    END IF;
  END IF;

  UPDATE erp_agente_mensagem SET acionamento = v_res, atualizado_em = now() WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true) || v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_agente_acionar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agente_acionar(uuid) TO service_role;
