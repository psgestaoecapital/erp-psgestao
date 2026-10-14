-- Chamado aberto pela equipe PS em nome do cliente: indica o solicitante (CEO 13/10, tarefa 97a5cb2a, item 2).
-- Aditivo: coluna nova (nula = comportamento de hoje) + a função existente passa a ler p_sugestao->>'solicitante_id'
-- (só aceito de usuário da própria empresa) + RPC de listagem restrita à equipe de suporte.
ALTER TABLE public.sugestoes ADD COLUMN IF NOT EXISTS solicitante_id uuid REFERENCES public.users(id);
CREATE INDEX IF NOT EXISTS idx_sugestoes_solicitante ON public.sugestoes (solicitante_id) WHERE solicitante_id IS NOT NULL;

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

  -- solicitante (cliente em nome de quem a equipe PS abre): só vale se for usuário DA empresa
  BEGIN v_sol := NULLIF(p_sugestao->>'solicitante_id','')::uuid; EXCEPTION WHEN others THEN v_sol := NULL; END;
  IF v_sol IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id = v_sol AND company_id = p_company_id) THEN
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

-- usuários da empresa para o seletor "Solicitante" (só equipe PS)
CREATE OR REPLACE FUNCTION public.fn_sugestao_solicitantes(p_company_id uuid)
 RETURNS TABLE(id uuid, nome text, email text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT u.id, COALESCE(u.full_name, u.email), u.email
  FROM user_companies uc JOIN users u ON u.id = uc.user_id
  WHERE uc.company_id = p_company_id
    AND EXISTS (SELECT 1 FROM users me WHERE me.id = auth.uid() AND me.system_role IN ('PS_ADMIN','PS_SUPPORT','PS_ADMIN_CVM'))
  ORDER BY 2
$$;
REVOKE ALL ON FUNCTION public.fn_sugestao_solicitantes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_solicitantes(uuid) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'melhorias.solicitante', 'Chamado', 'Solicitante', 'Escolha a pessoa da empresa que pediu a ajuda. Pode ficar vazio.', 'Quem for escolhido passa a ver o chamado como dele e recebe as respostas e os avisos.', 'Karol (financeiro) pediu por telefone para corrigir o extrato.', 'Deixar vazio quando o pedido veio de um cliente: ele não recebe a resposta.', 90, '/dashboard/melhorias', NULL, 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'melhorias.solicitante');
