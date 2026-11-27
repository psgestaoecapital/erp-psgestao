-- feat(consultor-ia): feedback (👍/👎) e registro automático de bug do SISTEMA (PR B).
-- Complementa a PR A (camada semântica + fn_consultor_sql). O agente, quando conclui que o problema é do SISTEMA (e não
-- do usuário), registra em erp_contexto_projeto (categoria 'descoberta', tag consultor_ia_bug) — vira fila do Eng. Chefe.

-- ───────── feedback do usuário por resposta ─────────
CREATE TABLE IF NOT EXISTS public.consultor_ia_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  user_id     uuid,
  pergunta_id uuid,
  pergunta    text,
  resposta    text,
  util        boolean,            -- 👍 true / 👎 false
  o_que_faltou text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultor_ia_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.consultor_ia_feedback FROM PUBLIC, anon;
DROP POLICY IF EXISTS consultor_ia_feedback_sel ON public.consultor_ia_feedback;
CREATE POLICY consultor_ia_feedback_sel ON public.consultor_ia_feedback FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.consultor_ia_feedback TO authenticated;

-- registra feedback (como o usuário logado; valida a empresa). SECURITY DEFINER para escrever na tabela fechada.
CREATE OR REPLACE FUNCTION public.fn_consultor_ia_feedback(p_company_id uuid, p_util boolean, p_pergunta text DEFAULT NULL,
  p_resposta text DEFAULT NULL, p_pergunta_id uuid DEFAULT NULL, p_o_que_faltou text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  INSERT INTO public.consultor_ia_feedback (company_id, user_id, pergunta_id, pergunta, resposta, util, o_que_faltou)
  VALUES (p_company_id, auth.uid(), p_pergunta_id, left(p_pergunta, 2000), left(p_resposta, 8000), p_util, left(p_o_que_faltou, 2000));
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.fn_consultor_ia_feedback(uuid, boolean, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_ia_feedback(uuid, boolean, text, text, uuid, text) TO authenticated, service_role;

-- registra bug do SISTEMA detectado pelo agente → erp_contexto_projeto (fila do Eng. Chefe). Dedup por título no dia.
CREATE OR REPLACE FUNCTION public.fn_consultor_ia_registrar_bug(p_company_id uuid, p_titulo text, p_descricao text,
  p_refs jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_tit text := left(coalesce(nullif(btrim(p_titulo),''),'Consultor IA: possível erro do sistema'), 200);
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()
          OR coalesce(current_setting('request.jwt.claims', true),'') = '' OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  -- dedup: mesmo título já aberto hoje não duplica
  SELECT id INTO v_id FROM public.erp_contexto_projeto
   WHERE categoria = 'descoberta' AND titulo = v_tit AND criado_em::date = CURRENT_DATE
     AND 'consultor_ia_bug' = ANY(COALESCE(tags, ARRAY[]::text[])) LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'id', v_id, 'dedup', true); END IF;
  INSERT INTO public.erp_contexto_projeto (projeto, categoria, prioridade, status, titulo, descricao, refs, tags, criado_por)
  VALUES ('consultor_ia', 'descoberta', 'alta', 'ativo', v_tit, left(p_descricao, 8000),
          COALESCE(p_refs,'{}'::jsonb) || jsonb_build_object('company_id', p_company_id),
          ARRAY['consultor_ia_bug'], auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.fn_consultor_ia_registrar_bug(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_ia_registrar_bug(uuid, text, text, jsonb) TO authenticated, service_role;

-- dicionário de dados (metadados, sem dado de empresa) para o system prompt do agente. Exposto por RPC porque o schema
-- consultor não é publicado pelo PostgREST. SECURITY DEFINER só lê consultor.dicionario (não toca dado de cliente).
CREATE OR REPLACE FUNCTION public.fn_consultor_dicionario()
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = consultor, public, pg_catalog AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('relacao', relacao, 'coluna', coluna, 'descricao', descricao)
           ORDER BY relacao, coluna), '[]'::jsonb)
  FROM consultor.dicionario
$$;
REVOKE ALL ON FUNCTION public.fn_consultor_dicionario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_dicionario() TO authenticated, service_role;

-- RD-95: "?" do aviso LGPD do Consultor IA (novo texto na tela).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES ('inteligencia.consultor.lgpd','/dashboard/consultor-ia','Consultor IA','Privacidade dos seus dados',
  'Nada a preencher — é um aviso.',
  'Explica como seus dados são usados: as respostas são geradas por IA e só os dados necessários para a sua pergunta são enviados ao provedor de IA, que não os usa para treinar modelos. A empresa é sempre a do seletor do topo.',
  'Pergunta "quanto recebi em outubro?" → só os títulos de outubro desta empresa vão ao modelo.',
  'Achar que todos os seus dados vão para a IA — vão só os necessários para a pergunta.',
  'inteligencia',10,'publicado')
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum, status = 'publicado';

-- RD-101: registra a mudança (Consultor IA passa a mandar dados minimizados ao modelo) no contexto do projeto.
INSERT INTO public.erp_contexto_projeto (projeto, categoria, prioridade, status, titulo, descricao, tags, criado_por)
SELECT 'consultor_ia', 'decisao', 'alta', 'ativo',
  'RD-101 muda: Consultor IA vira agente analista (dados minimizados vão ao modelo)',
  'CEO 25/11: o Consultor IA passa a consultar o banco da empresa como o Eng. Chefe (camada semântica + fn_consultor_sql, '
  || 'parser no Node). Só os dados necessários para a pergunta vão ao provedor de IA, que não os usa para treinar. '
  || 'Aviso LGPD na tela.', ARRAY['rd101','consultor_ia'], NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_contexto_projeto WHERE 'rd101' = ANY(COALESCE(tags, ARRAY[]::text[]))
    AND titulo LIKE 'RD-101 muda: Consultor IA%');
