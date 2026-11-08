-- #6725 — chamado: campo obrigatório "Em qual tela acontece?" (texto livre do usuário).
-- Aditivo: coluna nova NULL (chamados antigos não mudam). A rota automática continua gravada.
ALTER TABLE public.sugestoes ADD COLUMN IF NOT EXISTS tela_informada text;

CREATE OR REPLACE FUNCTION public.fn_sugestao_criar(p_company_id uuid, p_sugestao jsonb, p_anexos jsonb, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_email text; v_nome text; v_an jsonb; v_ord int := 0;
BEGIN
  -- PR A2b (CEO 28/09): a empresa tem de ser do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id IS NOT NULL AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF p_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario'); END IF;
  SELECT email, COALESCE(full_name, email) INTO v_email, v_nome FROM users WHERE id = p_user;

  INSERT INTO sugestoes (user_id, user_email, user_name, tipo, titulo, descricao, prioridade, status,
      company_id, rota, area, categoria, tela_informada)
  VALUES (p_user, v_email, v_nome, COALESCE(p_sugestao->>'tipo','melhoria'),
      NULLIF(p_sugestao->>'titulo',''), p_sugestao->>'descricao',
      COALESCE(NULLIF(p_sugestao->>'prioridade',''),'media'), 'nova',
      p_company_id, p_sugestao->>'rota', p_sugestao->>'area', NULLIF(p_sugestao->>'categoria',''),
      NULLIF(btrim(p_sugestao->>'tela_informada'),''))
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

-- RD-95: "?" do campo novo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'chamado.tela_informada', 'Chamados', 'Em qual tela acontece?',
  'Escreva o nome da tela onde o problema acontece, do jeito que você a chama. Campo obrigatório e sempre começa em branco.',
  'A equipe e o Code vão direto à tela certa, sem adivinhar. A tela de onde você abriu o chamado também fica gravada, como informação extra.',
  'Ordens de Serviço · NF-e recebidas · Perfil fiscal da revenda',
  'Deixar o nome da tela de onde abriu o chamado quando o assunto é de outra tela: informe a tela do problema.',
  0, '/dashboard/melhorias', 'gestao_empresarial', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

REVOKE ALL ON FUNCTION public.fn_sugestao_criar(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_criar(uuid, jsonb, jsonb, uuid) TO authenticated, service_role;
