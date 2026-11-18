-- Chamado aberto pela equipe PS em nome do cliente: indica o solicitante (cliente) para receber respostas/avisos.
-- Aditiva: coluna nova anulável. fn_sugestao_criar (existente) passa a ler p_sugestao->>'solicitante_id'
-- (definição viva lida com pg_get_functiondef em 14/10; resto do corpo inalterado).
ALTER TABLE public.sugestoes ADD COLUMN IF NOT EXISTS solicitante_id uuid;
COMMENT ON COLUMN public.sugestoes.solicitante_id IS 'Cliente em nome de quem a equipe PS abriu o chamado (recebe respostas/avisos). Deve ser usuário vinculado à empresa.';

CREATE OR REPLACE FUNCTION public.fn_sugestao_criar(p_company_id uuid, p_sugestao jsonb, p_anexos jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_email text; v_nome text; v_an jsonb; v_ord int := 0; v_sol uuid;
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id IS NOT NULL AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF p_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario'); END IF;
  SELECT email, COALESCE(full_name, email) INTO v_email, v_nome FROM users WHERE id = p_user;

  -- solicitante (opcional): só vale se for usuário vinculado à mesma empresa; senão ignora
  v_sol := NULLIF(p_sugestao->>'solicitante_id','')::uuid;
  IF v_sol IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = v_sol AND uc.company_id = p_company_id) THEN
    v_sol := NULL;
  END IF;

  INSERT INTO sugestoes (user_id, user_email, user_name, tipo, titulo, descricao, prioridade, status,
      company_id, rota, area, categoria, solicitante_id)
  VALUES (p_user, v_email, v_nome, COALESCE(p_sugestao->>'tipo','melhoria'),
      NULLIF(p_sugestao->>'titulo',''), p_sugestao->>'descricao',
      COALESCE(NULLIF(p_sugestao->>'prioridade',''),'media'), 'nova',
      p_company_id, p_sugestao->>'rota', p_sugestao->>'area', NULLIF(p_sugestao->>'categoria',''), v_sol)
  RETURNING id INTO v_id;

  IF p_anexos IS NOT NULL AND jsonb_typeof(p_anexos) = 'array' THEN
    FOR v_an IN SELECT * FROM jsonb_array_elements(p_anexos) LOOP
      INSERT INTO sugestao_anexo (sugestao_id, company_id, storage_path, url_publica, tipo, marcacoes, ordem, created_by)
      VALUES (v_id, p_company_id, v_an->>'storage_path', v_an->>'url_publica',
              COALESCE(v_an->>'tipo','imagem'), COALESCE(v_an->'marcacoes','[]'::jsonb), v_ord, p_user);
      v_ord := v_ord + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
