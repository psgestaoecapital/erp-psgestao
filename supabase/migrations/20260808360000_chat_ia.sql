-- SPEC · @Claude no Chat Interno (V2 do Comunicador #922). RD-56/RD-41/RD-51/RD-26.
-- Alguém escreve "@Claude ..." no canal e a IA responde ALI, ao vivo, pra todos — grounded nos dados
-- reais da empresa. Reuso total: chat realtime (#922), fn_odonto_clinica_contexto_ia (#918),
-- aiGuardedCall v2 + metering (#918), catálogo de features (#924). Aqui só: is_ia + RPC + feature.

-- 1) mensagem gerada pela IA (autor NULL → não é de ninguém; render distinto "Claude").
ALTER TABLE public.erp_chat_mensagem ADD COLUMN IF NOT EXISTS is_ia boolean NOT NULL DEFAULT false;
ALTER TABLE public.erp_chat_mensagem ALTER COLUMN user_id DROP NOT NULL;

-- 2) feature chat_ia (texto → default ON, custo baixo). Fonte única (#924).
INSERT INTO public.ia_feature_catalogo (feature, tipo, default_habilitado, custo_nivel)
VALUES ('chat_ia', 'texto', true, 'baixo')
ON CONFLICT (feature) DO UPDATE SET tipo = EXCLUDED.tipo, default_habilitado = EXCLUDED.default_habilitado, custo_nivel = EXCLUDED.custo_nivel;

-- 3) postar resposta da IA no canal (user_id NULL, is_ia=true). O CALLER precisa ser membro do canal
--    (a rota /api/chat/ia roda com o JWT de quem perguntou → é membro). Realtime entrega pra todos.
CREATE OR REPLACE FUNCTION public.fn_chat_enviar_ia(p_canal_id uuid, p_texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_company uuid; v_txt text := btrim(coalesce(p_texto,''));
BEGIN
  IF NOT fn_chat_is_member(p_canal_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso ao canal'); END IF;
  IF v_txt = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem vazia'); END IF;
  IF length(v_txt) > 4000 THEN v_txt := left(v_txt, 4000); END IF;
  SELECT company_id INTO v_company FROM erp_chat_canal WHERE id = p_canal_id;
  INSERT INTO erp_chat_mensagem (canal_id, company_id, user_id, texto, is_ia)
  VALUES (p_canal_id, v_company, NULL, v_txt, true) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_enviar_ia(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_enviar_ia(uuid,text) TO authenticated;

-- 4) mensagens: devolve is_ia + autor "Claude" quando is_ia (o front dá o visual 🤖).
CREATE OR REPLACE FUNCTION public.fn_chat_mensagens(p_canal_id uuid, p_limit int DEFAULT 50, p_before timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT fn_chat_is_member(p_canal_id) THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at ASC) FROM (
      SELECT msg.id, msg.user_id, msg.is_ia,
             CASE WHEN msg.is_ia THEN 'Claude' ELSE coalesce(u.full_name, u.email, 'Usuário') END AS autor,
             msg.texto, msg.created_at, msg.editado_em
      FROM erp_chat_mensagem msg LEFT JOIN users u ON u.id = msg.user_id
      WHERE msg.canal_id = p_canal_id AND msg.deletado_em IS NULL
        AND (p_before IS NULL OR msg.created_at < p_before)
      ORDER BY msg.created_at DESC LIMIT greatest(1, least(coalesce(p_limit,50), 100))
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_mensagens(uuid,int,timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_mensagens(uuid,int,timestamptz) TO authenticated;

-- 5) canais: não-lidas conta também as msgs da IA (user_id NULL) → IS DISTINCT FROM (NULL <> uid dava NULL).
CREATE OR REPLACE FUNCTION public.fn_chat_canais(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.tipo, x.ultima_em DESC NULLS LAST) FROM (
      SELECT c.id AS canal_id, c.tipo,
        CASE WHEN c.tipo = 'geral' THEN coalesce(c.nome, 'Equipe')
             ELSE coalesce((SELECT u.full_name FROM erp_chat_membro m2 JOIN users u ON u.id = m2.user_id
                            WHERE m2.canal_id = c.id AND m2.user_id <> v_uid LIMIT 1), 'Conversa') END AS nome,
        (SELECT m3.user_id FROM erp_chat_membro m3 WHERE m3.canal_id = c.id AND m3.user_id <> v_uid LIMIT 1) AS outro_user_id,
        (SELECT msg.texto FROM erp_chat_mensagem msg WHERE msg.canal_id = c.id AND msg.deletado_em IS NULL ORDER BY msg.created_at DESC LIMIT 1) AS ultima_msg,
        (SELECT msg.created_at FROM erp_chat_mensagem msg WHERE msg.canal_id = c.id AND msg.deletado_em IS NULL ORDER BY msg.created_at DESC LIMIT 1) AS ultima_em,
        (SELECT count(*) FROM erp_chat_mensagem msg WHERE msg.canal_id = c.id AND msg.deletado_em IS NULL
            AND msg.user_id IS DISTINCT FROM v_uid AND msg.created_at > mem.last_read_at) AS nao_lidas
      FROM erp_chat_canal c
      JOIN erp_chat_membro mem ON mem.canal_id = c.id AND mem.user_id = v_uid
      WHERE c.company_id = p_company_id
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_canais(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_canais(uuid) TO authenticated;
