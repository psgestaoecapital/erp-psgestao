-- RD-41 · Central de Ajuda AI-native · F0.2 (resposta conversacional grounded — RAG + LLM).
-- Fecha o F0. A IA responde em linguagem natural ANCORADA 100% nos artigos (RAG): recupera top-K por
-- FTS (mesma RBAC/tenant de fn_ajuda_buscar), monta o contexto SÓ com esses artigos e o LLM responde.
-- Guardas: RD-51/58 grounding (só os artigos; escala se não sabe); RD-42 cache + LLM sob demanda +
-- modelo econômico + telemetria de custo; Pilar 2 tenant/papel; LGPD (cache sem pergunta crua + RLS +
-- retenção). O LLM roda no /api/ajuda/perguntar (Node) — aqui ficam retrieve grounded, cache e telemetria.

-- ── 1. cache de respostas (RD-42) ────────────────────────────────────────────────────────────────
-- LGPD: NÃO guarda a pergunta crua, só o hash normalizado. A resposta é grounded (conteúdo dos artigos,
-- genérico), sem dado pessoal. Escopo por (company_id NULL=global | tenant) + papel (RBAC das fontes).
CREATE TABLE IF NOT EXISTS public.erp_ajuda_cache (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NULL,                 -- NULL = global; preenchido = do tenant
  pergunta_hash text NOT NULL,             -- md5 da pergunta normalizada (sem a pergunta crua — LGPD)
  papel         int  NOT NULL DEFAULT 1,   -- papel p/ o qual a resposta foi gerada (RBAC das fontes)
  resposta      text NOT NULL,
  artigos_ref   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{artigo_id, titulo, rota_ref}] usados (fontes)
  modelo        text NULL,
  hits          int  NOT NULL DEFAULT 0,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ajuda_cache_chave
  ON public.erp_ajuda_cache (pergunta_hash, papel, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ── 2. telemetria de custo / resolução (RD-42) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_ajuda_llm_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NULL,
  user_id     uuid NULL,
  pergunta    text NULL,                   -- p/ análise de gaps (admin-only; retenção definida)
  cache_hit   boolean NOT NULL DEFAULT false,
  escalou     boolean NOT NULL DEFAULT false,   -- true = sem cobertura → encaminhou p/ suporte (sem LLM)
  modelo      text NULL,
  tokens_in   int  NULL,
  tokens_out  int  NULL,
  custo_usd   numeric(12,6) NULL,
  artigos_ref jsonb NULL,
  rota        text NULL,
  papel       int  NULL,
  resolveu    boolean NULL,                -- 👍/👎 (atualizado depois via fn_ajuda_registrar_uso)
  criado_em   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ajuda_llm_log_criado ON public.erp_ajuda_llm_log (criado_em DESC);

-- ── 3. RLS (Pilar 2 + LGPD) ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_ajuda_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_ajuda_llm_log ENABLE ROW LEVEL SECURITY;

-- cache: leitura só de global/tenant do usuário; escrita só via RPC SECURITY DEFINER (nada direto).
DROP POLICY IF EXISTS ajuda_cache_sel ON public.erp_ajuda_cache;
CREATE POLICY ajuda_cache_sel ON public.erp_ajuda_cache FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()) OR public.is_admin());

-- log: leitura só admin (LGPD — pode conter pergunta com dado pessoal); insert via RPC.
DROP POLICY IF EXISTS ajuda_llm_log_sel ON public.erp_ajuda_llm_log;
CREATE POLICY ajuda_llm_log_sel ON public.erp_ajuda_llm_log FOR SELECT TO authenticated
  USING (public.is_admin());

-- ── 4. RETRIEVE grounded (RD-51) — top-K com corpo_md, mesma RBAC/tenant de fn_ajuda_buscar ─────
-- Separado da busca (tier-1) porque devolve o CORPO dos artigos (contexto do RAG), não só o resumo.
CREATE OR REPLACE FUNCTION public.fn_ajuda_rag_contexto(p_company_id uuid, p_termo text, p_rota_atual text DEFAULT NULL, p_papel int DEFAULT 1, p_k int DEFAULT 5)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_q tsquery; v_out jsonb; v_vert_atual text; v_admin boolean := public.is_admin();
BEGIN
  IF p_company_id IS NOT NULL AND NOT v_admin AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  v_q := websearch_to_tsquery('portuguese', COALESCE(p_termo,''));
  IF v_q IS NULL OR numnode(v_q) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'resultados', '[]'::jsonb);
  END IF;
  IF p_rota_atual IS NOT NULL THEN
    SELECT area INTO v_vert_atual FROM system_screens WHERE rota = p_rota_atual LIMIT 1;
  END IF;

  SELECT jsonb_agg(x ORDER BY (x->>'score')::numeric DESC)
    INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'artigo_id', a.id, 'titulo', a.titulo, 'resumo', a.resumo, 'corpo_md', a.corpo_md,
      'rota_ref', a.rota_ref, 'vertical', a.vertical,
      'score', round((ts_rank(a.search_tsv, v_q)
        + CASE WHEN p_rota_atual IS NOT NULL AND a.rota_ref = p_rota_atual THEN 1.0
               WHEN v_vert_atual IS NOT NULL AND a.vertical = v_vert_atual THEN 0.2
               ELSE 0 END)::numeric, 4)
    ) AS x
    FROM erp_ajuda_artigo a
    WHERE a.status = 'publicado'
      AND a.search_tsv @@ v_q
      AND (a.company_id IS NULL OR a.company_id = p_company_id)
      AND (v_admin OR a.papel_min <= COALESCE(p_papel, 1))
    ORDER BY ts_rank(a.search_tsv, v_q) DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_k, 5), 10))
  ) t;

  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_rag_contexto(uuid, text, text, int, int) TO authenticated;

-- ── 5. CACHE obter (RD-42) — hit devolve resposta + hits++; invalida se fonte mudou ou expirou ──
-- Invalidação (RD-51): se qualquer artigo-fonte foi atualizado depois do cache, o cache é ignorado
-- (a curadoria muda o conteúdo → resposta velha não vale). Também expira em 30 dias.
CREATE OR REPLACE FUNCTION public.fn_ajuda_cache_obter(p_company_id uuid, p_hash text, p_papel int)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_row erp_ajuda_cache; v_stale boolean;
BEGIN
  IF p_company_id IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'hit', false);
  END IF;

  SELECT * INTO v_row FROM erp_ajuda_cache c
   WHERE c.pergunta_hash = p_hash AND c.papel = COALESCE(p_papel,1)
     AND c.company_id IS NOT DISTINCT FROM p_company_id
     AND c.criado_em > now() - interval '30 days'
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'hit', false); END IF;

  -- alguma fonte mudou após o cache? então está velho (não usa).
  SELECT EXISTS (
    SELECT 1 FROM erp_ajuda_artigo a
    WHERE a.id IN (SELECT (jsonb_array_elements(v_row.artigos_ref)->>'artigo_id')::uuid)
      AND a.atualizado_em > v_row.criado_em
  ) INTO v_stale;
  IF v_stale THEN RETURN jsonb_build_object('ok', true, 'hit', false); END IF;

  UPDATE erp_ajuda_cache SET hits = hits + 1 WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true, 'hit', true,
    'resposta', v_row.resposta, 'artigos_ref', v_row.artigos_ref, 'modelo', v_row.modelo);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_cache_obter(uuid, text, int) TO authenticated;

-- ── 6. CACHE gravar (miss) — upsert por chave (hash, papel, company) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ajuda_cache_gravar(p_company_id uuid, p_hash text, p_papel int, p_resposta text, p_artigos_ref jsonb, p_modelo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso');
  END IF;
  INSERT INTO erp_ajuda_cache (company_id, pergunta_hash, papel, resposta, artigos_ref, modelo)
  VALUES (p_company_id, p_hash, COALESCE(p_papel,1), p_resposta, COALESCE(p_artigos_ref,'[]'::jsonb), p_modelo)
  ON CONFLICT (pergunta_hash, papel, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET resposta = EXCLUDED.resposta, artigos_ref = EXCLUDED.artigos_ref,
                modelo = EXCLUDED.modelo, atualizado_em = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_cache_gravar(uuid, text, int, text, jsonb, text) TO authenticated;

-- ── 7. TELEMETRIA (RD-42) — 1 registro por resposta (hit, miss ou escala) ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_ajuda_llm_registrar(p_company_id uuid, p_pergunta text, p_cache_hit boolean, p_escalou boolean, p_modelo text, p_tokens_in int, p_tokens_out int, p_custo numeric, p_artigos_ref jsonb, p_rota text, p_papel int)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso');
  END IF;
  INSERT INTO erp_ajuda_llm_log (company_id, user_id, pergunta, cache_hit, escalou, modelo,
    tokens_in, tokens_out, custo_usd, artigos_ref, rota, papel)
  VALUES (p_company_id, auth.uid(), nullif(btrim(p_pergunta),''), COALESCE(p_cache_hit,false),
    COALESCE(p_escalou,false), p_modelo, p_tokens_in, p_tokens_out, p_custo, p_artigos_ref, p_rota, p_papel)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_llm_registrar(uuid, text, boolean, boolean, text, int, int, numeric, jsonb, text, int) TO authenticated;
