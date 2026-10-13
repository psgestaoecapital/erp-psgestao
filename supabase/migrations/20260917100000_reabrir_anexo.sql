-- #2 fast-follow (Rodrigo/CEO) — "Ainda não resolveu" passa a aceitar FOTO, como o compositor
-- normal. fn_sugestao_confirmar ganha p_anexos: ao reabrir, além de gravar a devolutiva como
-- mensagem (papel='autor', migration 20260917090000), anexa as fotos a essa mensagem em
-- sugestao_anexo (mesmo modelo do fn_sugestao_mensagem_enviar: mensagem_id + storage_path + marcacoes).

CREATE OR REPLACE FUNCTION public.fn_sugestao_confirmar(
  p_id uuid, p_user uuid, p_funcionou boolean, p_motivo text DEFAULT NULL::text,
  p_anexos jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_autor uuid; v_aprovada boolean; v_numero int; v_company uuid; v_msg_id uuid;
BEGIN
  SELECT user_id, resposta_aprovada, numero, company_id
    INTO v_autor, v_aprovada, v_numero, v_company FROM sugestoes WHERE id = p_id;
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
      resposta_aprovada = false, updated_at = now() WHERE id = p_id;
    -- devolutiva na thread (papel='autor')
    INSERT INTO sugestao_mensagem (sugestao_id, autor_id, papel, texto, criado_em)
    VALUES (p_id, v_autor, 'autor', btrim(p_motivo), now())
    RETURNING id INTO v_msg_id;
    -- #2 fast-follow · anexa as fotos à mensagem da devolutiva (se houver)
    IF jsonb_typeof(COALESCE(p_anexos,'[]'::jsonb)) = 'array' AND jsonb_array_length(COALESCE(p_anexos,'[]'::jsonb)) > 0 THEN
      INSERT INTO sugestao_anexo (sugestao_id, mensagem_id, company_id, storage_path, marcacoes, ordem, created_by, tipo)
      SELECT p_id, v_msg_id, v_company, a->>'storage_path',
             COALESCE(a->'marcacoes','[]'::jsonb), (ord-1)::int, v_autor, 'imagem'
      FROM jsonb_array_elements(p_anexos) WITH ORDINALITY AS t(a, ord)
      WHERE COALESCE(a->>'storage_path','') <> '';
    END IF;
    -- notificação aos PS admins (inalterada)
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_id, u.id, 'reaberto', '#' || v_numero || ' · Chamado reaberto pelo autor', p_motivo
    FROM users u WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM');
    RETURN jsonb_build_object('ok', true, 'status', 'em_desenvolvimento', 'reaberto', true, 'mensagem_id', v_msg_id);
  END IF;
END $function$;
