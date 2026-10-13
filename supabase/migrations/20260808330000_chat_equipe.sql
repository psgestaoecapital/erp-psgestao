-- SPEC · Comunicador Interno da Equipe (chat de equipe · widget flutuante · tempo real). RD-56/RD-41/RD-26.
-- Genérico (todas as verticais). Reuso: tenant_user_roles (equipe), Supabase Realtime (tempo real),
-- get_user_company_ids() (tenant). Soft-delete (RD-55). RLS por MEMBERSHIP (via helper SECURITY DEFINER
-- p/ evitar recursão de policy). Canal 'geral' lazy por empresa (criado no 1º acesso; membros = ativos).

-- ── 1) Tabelas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_chat_canal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tipo text NOT NULL DEFAULT 'geral',   -- 'geral' (equipe toda) | 'direta' (1:1)
  nome text,
  criado_por uuid DEFAULT auth.uid(), created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.erp_chat_membro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id uuid NOT NULL REFERENCES public.erp_chat_canal(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamptz DEFAULT now(),
  UNIQUE (canal_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.erp_chat_mensagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id uuid NOT NULL REFERENCES public.erp_chat_canal(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  texto text NOT NULL,
  created_at timestamptz DEFAULT now(),
  editado_em timestamptz, deletado_em timestamptz
);
CREATE INDEX IF NOT EXISTS ix_chat_msg_canal ON public.erp_chat_mensagem (canal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_chat_membro_user ON public.erp_chat_membro (user_id);
CREATE INDEX IF NOT EXISTS ix_chat_canal_geral ON public.erp_chat_canal (company_id, tipo);

-- ── 2) Helper de membership (SECURITY DEFINER → sem recursão de RLS) ──────────
CREATE OR REPLACE FUNCTION public.fn_chat_is_member(p_canal uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM erp_chat_membro WHERE canal_id = p_canal AND user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.fn_chat_is_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_is_member(uuid) TO authenticated;

-- ── 3) RLS (SELECT por membership; escrita passa pelas RPCs) ──────────────────
ALTER TABLE public.erp_chat_canal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_chat_membro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_chat_mensagem ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sel_chat_canal ON public.erp_chat_canal;
CREATE POLICY sel_chat_canal ON public.erp_chat_canal FOR SELECT TO authenticated USING (fn_chat_is_member(id));
DROP POLICY IF EXISTS sel_chat_membro ON public.erp_chat_membro;
CREATE POLICY sel_chat_membro ON public.erp_chat_membro FOR SELECT TO authenticated USING (fn_chat_is_member(canal_id));
DROP POLICY IF EXISTS sel_chat_msg ON public.erp_chat_mensagem;
CREATE POLICY sel_chat_msg ON public.erp_chat_mensagem FOR SELECT TO authenticated USING (fn_chat_is_member(canal_id));

-- ── 4) Realtime: publica a tabela de mensagens (tempo real nativo) ───────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='erp_chat_mensagem') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.erp_chat_mensagem;
  END IF;
END $$;

-- ── 5) Bootstrap: garante canal 'geral' + membros (ativos da empresa) ─────────
CREATE OR REPLACE FUNCTION public.fn_chat_bootstrap(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_geral uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  SELECT id INTO v_geral FROM erp_chat_canal WHERE company_id = p_company_id AND tipo = 'geral' LIMIT 1;
  IF v_geral IS NULL THEN
    INSERT INTO erp_chat_canal (company_id, tipo, nome, criado_por) VALUES (p_company_id, 'geral', 'Equipe', auth.uid())
    RETURNING id INTO v_geral;
  END IF;
  INSERT INTO erp_chat_membro (canal_id, company_id, user_id)
  SELECT v_geral, p_company_id, tur.user_id FROM tenant_user_roles tur
  WHERE tur.company_id = p_company_id AND tur.is_active
    AND NOT EXISTS (SELECT 1 FROM erp_chat_membro m WHERE m.canal_id = v_geral AND m.user_id = tur.user_id);
  -- garante o caller como membro (mesmo se admin fora de tenant_user_roles)
  INSERT INTO erp_chat_membro (canal_id, company_id, user_id)
  SELECT v_geral, p_company_id, auth.uid()
  WHERE NOT EXISTS (SELECT 1 FROM erp_chat_membro m WHERE m.canal_id = v_geral AND m.user_id = auth.uid());
  RETURN jsonb_build_object('ok', true, 'geral_id', v_geral);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_bootstrap(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_bootstrap(uuid) TO authenticated;

-- ── 6) Meus canais (com nome do outro na direta, última msg, não-lidas) ──────
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
            AND msg.user_id <> v_uid AND msg.created_at > mem.last_read_at) AS nao_lidas
      FROM erp_chat_canal c
      JOIN erp_chat_membro mem ON mem.canal_id = c.id AND mem.user_id = v_uid
      WHERE c.company_id = p_company_id
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_canais(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_canais(uuid) TO authenticated;

-- ── 7) Mensagens do canal (paginado, com autor) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_mensagens(p_canal_id uuid, p_limit int DEFAULT 50, p_before timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT fn_chat_is_member(p_canal_id) THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at ASC) FROM (
      SELECT msg.id, msg.user_id, coalesce(u.full_name, u.email, 'Usuário') AS autor, msg.texto, msg.created_at, msg.editado_em
      FROM erp_chat_mensagem msg LEFT JOIN users u ON u.id = msg.user_id
      WHERE msg.canal_id = p_canal_id AND msg.deletado_em IS NULL
        AND (p_before IS NULL OR msg.created_at < p_before)
      ORDER BY msg.created_at DESC LIMIT greatest(1, least(coalesce(p_limit,50), 100))
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_mensagens(uuid,int,timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_mensagens(uuid,int,timestamptz) TO authenticated;

-- ── 8) Enviar (valida membership) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_enviar(p_canal_id uuid, p_texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_company uuid; v_txt text := btrim(coalesce(p_texto,''));
BEGIN
  IF NOT fn_chat_is_member(p_canal_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso ao canal'); END IF;
  IF v_txt = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem vazia'); END IF;
  IF length(v_txt) > 4000 THEN v_txt := left(v_txt, 4000); END IF;
  SELECT company_id INTO v_company FROM erp_chat_canal WHERE id = p_canal_id;
  INSERT INTO erp_chat_mensagem (canal_id, company_id, user_id, texto)
  VALUES (p_canal_id, v_company, auth.uid(), v_txt) RETURNING id INTO v_id;
  UPDATE erp_chat_membro SET last_read_at = now() WHERE canal_id = p_canal_id AND user_id = auth.uid();
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_enviar(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_enviar(uuid,text) TO authenticated;

-- ── 9) Marcar lido ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_marcar_lido(p_canal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT fn_chat_is_member(p_canal_id) THEN RETURN jsonb_build_object('ok', false); END IF;
  UPDATE erp_chat_membro SET last_read_at = now() WHERE canal_id = p_canal_id AND user_id = auth.uid();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_marcar_lido(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_marcar_lido(uuid) TO authenticated;

-- ── 10) Abrir/achar direta 1:1 (idempotente) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_direta_abrir(p_company_id uuid, p_user_destino uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_canal uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF p_user_destino = v_uid THEN RETURN jsonb_build_object('ok', false, 'erro', 'não dá pra conversar consigo'); END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_user_roles WHERE company_id = p_company_id AND user_id = p_user_destino AND is_active) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'usuário não está na equipe'); END IF;
  SELECT c.id INTO v_canal FROM erp_chat_canal c
   WHERE c.company_id = p_company_id AND c.tipo = 'direta'
     AND EXISTS (SELECT 1 FROM erp_chat_membro m WHERE m.canal_id = c.id AND m.user_id = v_uid)
     AND EXISTS (SELECT 1 FROM erp_chat_membro m WHERE m.canal_id = c.id AND m.user_id = p_user_destino)
     AND (SELECT count(*) FROM erp_chat_membro m WHERE m.canal_id = c.id) = 2
   LIMIT 1;
  IF v_canal IS NULL THEN
    INSERT INTO erp_chat_canal (company_id, tipo, nome, criado_por) VALUES (p_company_id, 'direta', NULL, v_uid) RETURNING id INTO v_canal;
    INSERT INTO erp_chat_membro (canal_id, company_id, user_id) VALUES (v_canal, p_company_id, v_uid), (v_canal, p_company_id, p_user_destino);
  END IF;
  RETURN jsonb_build_object('ok', true, 'canal_id', v_canal);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_direta_abrir(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_direta_abrir(uuid,uuid) TO authenticated;

-- ── 11) Equipe da empresa (para iniciar direta + presença) ───────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_equipe(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('user_id', t.user_id, 'nome', coalesce(u.full_name, u.email, 'Usuário'),
                                        'email', u.email, 'role', t.role) ORDER BY coalesce(u.full_name, u.email))
    FROM (SELECT DISTINCT user_id, role FROM tenant_user_roles WHERE company_id = p_company_id AND is_active AND user_id <> v_uid) t
    JOIN users u ON u.id = t.user_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_chat_equipe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_chat_equipe(uuid) TO authenticated;
