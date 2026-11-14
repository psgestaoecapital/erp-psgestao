-- #6930: mensagem do AUTOR no chamado avisa o atendente. Antes só avisava usuários PS_*; um responsável de outro perfil
-- (ex.: sócio) não era avisado e ultimo_movimento não andava. Agora: ultimo_movimento = now() e o responsável
-- (sugestoes.responsavel_id) recebe a notificação (sem duplicar com quem já é PS_*). Status e contrato de retorno iguais.
CREATE OR REPLACE FUNCTION public.fn_sugestao_mensagem_enviar(p_sugestao_id uuid, p_user uuid, p_texto text DEFAULT NULL::text, p_anexos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_autor_chamado uuid; v_company uuid; v_titulo text; v_status text; v_numero int; v_resp uuid;
  v_papel text; v_msg_id uuid; v_email text; v_an jsonb; v_ord int := 0;
  v_tem_anexo boolean := (p_anexos IS NOT NULL AND jsonb_typeof(p_anexos) = 'array' AND jsonb_array_length(p_anexos) > 0);
  v_anexo_ids uuid[] := ARRAY[]::uuid[]; v_new_anexo uuid;
BEGIN
  SELECT user_id, company_id, titulo, status, numero, responsavel_id INTO v_autor_chamado, v_company, v_titulo, v_status, v_numero, v_resp
    FROM sugestoes WHERE id = p_sugestao_id;
  IF v_autor_chamado IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;

  IF auth.uid() = v_autor_chamado THEN v_papel := 'autor';
  ELSIF is_admin() OR fn_pode_ver_fila_suporte() THEN v_papel := 'ps';
  ELSE RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  IF COALESCE(btrim(p_texto),'') = '' AND NOT v_tem_anexo THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_vazia'); END IF;

  SELECT email INTO v_email FROM users WHERE id = p_user;

  INSERT INTO sugestao_mensagem (sugestao_id, autor_id, autor_email, papel, texto)
  VALUES (p_sugestao_id, p_user, v_email, v_papel, NULLIF(btrim(p_texto),''))
  RETURNING id INTO v_msg_id;

  IF v_tem_anexo THEN
    FOR v_an IN SELECT * FROM jsonb_array_elements(p_anexos) LOOP
      INSERT INTO sugestao_anexo (sugestao_id, mensagem_id, company_id, storage_path, url_publica, tipo, marcacoes, ordem, created_by)
      VALUES (p_sugestao_id, v_msg_id, v_company, v_an->>'storage_path', v_an->>'url_publica',
              COALESCE(v_an->>'tipo','imagem'), COALESCE(v_an->'marcacoes','[]'::jsonb), v_ord, p_user)
      RETURNING id INTO v_new_anexo;
      v_anexo_ids := v_anexo_ids || v_new_anexo;
      v_ord := v_ord + 1;
    END LOOP;
  END IF;

  IF v_papel = 'autor' THEN
    -- o cliente respondeu: a bola volta para a PS (sai de "aguardando confirmação" e reabre o que estava encerrado)
    UPDATE sugestoes SET
      status = CASE WHEN status IN ('concluida','recusada','duplicada','arquivada','aguardando_confirmacao') THEN 'em_desenvolvimento' ELSE status END,
      confirmado_pelo_autor = false, updated_at = now(), ultimo_movimento = now()
    WHERE id = p_sugestao_id;
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    SELECT p_sugestao_id, u.id, 'mensagem',
           '#' || v_numero || ' · Nova mensagem no chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sem título'),
           left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200)
    FROM users u
    WHERE u.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM')
       OR (u.id = v_resp AND v_resp <> v_autor_chamado);
  ELSE
    INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
    VALUES (p_sugestao_id, v_autor_chamado, 'mensagem',
            '#' || v_numero || ' · Nova mensagem no seu chamado: ' || COALESCE(NULLIF(btrim(v_titulo),''), 'sua sugestão'),
            left(COALESCE(NULLIF(btrim(p_texto),''), '(enviou uma imagem)'), 200));
  END IF;

  RETURN jsonb_build_object('ok', true, 'mensagem_id', v_msg_id, 'papel', v_papel,
                            'anexos', to_jsonb(v_anexo_ids), 'tem_foto', v_tem_anexo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_sugestao_mensagem_enviar(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_mensagem_enviar(uuid, uuid, text, jsonb) TO authenticated, service_role;
