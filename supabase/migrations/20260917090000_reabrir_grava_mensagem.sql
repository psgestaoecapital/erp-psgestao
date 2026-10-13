-- #2 (Rodrigo/CEO) — "Ainda não resolveu": a devolutiva do cliente SUMIA do histórico.
-- fn_sugestao_confirmar (reabrir) gravava o motivo só em sugestao_notificacao (alerta transitório
-- para os PS admins) e NUNCA em sugestao_mensagem (a thread de conversa). Resultado: o cliente
-- escreve, reabre, e o texto não aparece na conversa — ninguém lê. É o caminho inverso do #79
-- (as respostas da PS já entram na thread; a devolutiva do autor não entrava).
--
-- Correção: ao reabrir, ALÉM da notificação, grava a devolutiva como mensagem papel='autor'.
-- (papel ∈ {autor, ps}; autor_id = o próprio autor que reabriu.)

CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmar(p_id uuid, p_user uuid, p_funcionou boolean, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_aprovada boolean; v_numero int;
BEGIN
  SELECT user_id, resposta_aprovada, numero INTO v_autor, v_aprovada, v_numero FROM sugestoes WHERE id = p_id;
  IF v_autor IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF auth.uid() <> v_autor THEN RETURN jsonb_build_object('ok', false, 'erro', 'so_o_autor_confirma'); END IF;
  IF NOT COALESCE(v_aprovada, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_resposta_aprovada'); END IF;

  IF p_funcionou THEN
    UPDATE sugestoes SET confirmado_pelo_autor = true, confirmado_em = now(),
      status = 'concluida', concluido_em = now(), updated_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 'concluida');
  ELSE
    IF COALESCE(btrim(p_motivo),'') = '' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
    UPDATE sugestoes SET confirmado_pelo_autor = false, status = 'em_desenvolvimento',
      resposta_aprovada = false,
      updated_at = now() WHERE id = p_id;
    -- #2 · a devolutiva ENTRA na thread (não some mais). papel='autor'.
    INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, criado_em)
    VALUES (p_id, v_autor, 'autor', btrim(p_motivo), now());
    -- (mantém a notificação aos PS admins)
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', p_motivo
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
    RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true);
  END IF;
END $function$;
