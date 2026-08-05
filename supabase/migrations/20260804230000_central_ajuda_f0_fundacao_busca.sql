-- RD-41 · Central de Ajuda AI-native · F0 Fatia 1+2 (fundação + busca FTS grounded).
-- Transversal (D1), interna (D3), sem modo Fazer (D2). Grounding (RD-51/58): responde só ancorado no
-- que existe; sem match → vazio (front escala). Custo ~zero (FTS puro, sem LLM — RD-42). RD-26: reusa
-- system_screens (catálogo das 198 telas) e get_user_company_ids/is_admin.
--
-- Nota honesta (RD-38): o seed PUBLICA as telas que já têm descricao_funcional (conteúdo humano do
-- catálogo, grounded); as telas SEM descrição entram como rascunho + is_gap (curadoria IA — Fatia 4).
-- Assim a busca já funciona hoje sem inventar nada.

-- ── 1.1 categorias ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_ajuda_categoria (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,                 -- NULL = global
  vertical   text NULL,
  nome       text NOT NULL,
  ordem      int  DEFAULT 0,
  ativo      boolean DEFAULT true,
  criado_em  timestamptz DEFAULT now()
);

-- ── 1.2 artigos (tsv como GENERATED — sem trigger) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_ajuda_artigo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NULL,              -- NULL = global; preenchido = do tenant
  categoria_id  uuid NULL REFERENCES public.erp_ajuda_categoria(id) ON DELETE SET NULL,
  rota_ref      text NULL,              -- liga à tela (system_screens.rota)
  titulo        text NOT NULL,
  resumo        text NULL,
  corpo_md      text NULL,
  vertical      text NULL,
  papel_min     int  NOT NULL DEFAULT 1,   -- 1=VIEWER 2=OPERATOR 3=MANAGER 4=OWNER (PS_ADMIN vê tudo)
  fonte         text NOT NULL DEFAULT 'system_screens',   -- system_screens | manual | faq
  status        text NOT NULL DEFAULT 'rascunho',         -- rascunho | publicado
  is_gap        boolean NOT NULL DEFAULT false,           -- tela sem descrição (RD-51: sinaliza, não inventa)
  search_tsv    tsvector GENERATED ALWAYS AS (
                  to_tsvector('portuguese',
                    coalesce(titulo,'') || ' ' || coalesce(resumo,'') || ' ' || coalesce(corpo_md,''))
                ) STORED,
  criado_por    uuid NULL,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- ── 2.2 uso (métricas + gaps) ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_ajuda_uso (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,
  user_id    uuid NULL,
  pergunta   text NULL,
  resolveu   boolean NULL,
  artigo_id  uuid NULL,
  rota       text NULL,
  papel      int NULL,
  criado_em  timestamptz DEFAULT now()
);

-- ── 1.3 índices ────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ajuda_artigo_tsv  ON public.erp_ajuda_artigo USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_ajuda_artigo_rota ON public.erp_ajuda_artigo (rota_ref);
CREATE INDEX IF NOT EXISTS idx_ajuda_artigo_comp ON public.erp_ajuda_artigo (company_id);

-- ── 1.4 RLS (Pilar 2) ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_ajuda_categoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_ajuda_artigo    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_ajuda_uso       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ajuda_cat_sel ON public.erp_ajuda_categoria;
CREATE POLICY ajuda_cat_sel ON public.erp_ajuda_categoria FOR SELECT TO authenticated
  USING ((ativo AND (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()))) OR public.is_admin());
DROP POLICY IF EXISTS ajuda_cat_admin ON public.erp_ajuda_categoria;
CREATE POLICY ajuda_cat_admin ON public.erp_ajuda_categoria FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS ajuda_art_sel ON public.erp_ajuda_artigo;
CREATE POLICY ajuda_art_sel ON public.erp_ajuda_artigo FOR SELECT TO authenticated
  USING ((status='publicado' AND (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()))) OR public.is_admin());
DROP POLICY IF EXISTS ajuda_art_admin ON public.erp_ajuda_artigo;
CREATE POLICY ajuda_art_admin ON public.erp_ajuda_artigo FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS ajuda_uso_ins ON public.erp_ajuda_uso;
CREATE POLICY ajuda_uso_ins ON public.erp_ajuda_uso FOR INSERT TO authenticated
  WITH CHECK (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS ajuda_uso_sel ON public.erp_ajuda_uso;
CREATE POLICY ajuda_uso_sel ON public.erp_ajuda_uso FOR SELECT TO authenticated
  USING (public.is_admin());

-- ── 1.6 seed grounded a partir de system_screens (RD-26/RD-51) ─────────────────────────────────
-- Idempotente: só semeia rotas ainda não semeadas (fonte system_screens).
INSERT INTO public.erp_ajuda_artigo (company_id, rota_ref, titulo, resumo, corpo_md, vertical, papel_min, fonte, status, is_gap)
SELECT NULL, s.rota,
  COALESCE(NULLIF(btrim(s.titulo),''), s.rota),
  NULLIF(split_part(btrim(coalesce(s.descricao_funcional,'')), E'\n', 1), ''),
  NULLIF(btrim(coalesce(s.descricao_funcional,'')), ''),
  s.area,
  CASE s.area
    WHEN 'admin' THEN 4 WHEN 'admin_legado' THEN 4
    WHEN 'gestao_empresarial' THEN 3 WHEN 'financeiro' THEN 3 WHEN 'contador' THEN 3
    WHEN 'bpo' THEN 3 WHEN 'wealth' THEN 3 WHEN 'assessor' THEN 3 WHEN 'compliance' THEN 3
    WHEN 'integrations' THEN 3 WHEN 'inteligencia' THEN 3
    WHEN 'oficina' THEN 2 WHEN 'odonto' THEN 2 WHEN 'hub_construcao' THEN 2
    WHEN 'industrial' THEN 2 WHEN 'operacao' THEN 2 WHEN 'commerce' THEN 2 WHEN 'pm' THEN 2
    ELSE 1 END,
  'system_screens',
  CASE WHEN COALESCE(NULLIF(btrim(s.descricao_funcional),''),'') = '' THEN 'rascunho' ELSE 'publicado' END,
  (COALESCE(NULLIF(btrim(s.descricao_funcional),''),'') = '')
FROM public.system_screens s
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_artigo a WHERE a.fonte='system_screens' AND a.company_id IS NULL AND a.rota_ref = s.rota
);

-- ── 2.1 busca (FTS PT + boost de contexto + RBAC + tenant) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ajuda_buscar(p_company_id uuid, p_termo text, p_rota_atual text DEFAULT NULL, p_papel int DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_q tsquery; v_out jsonb; v_vert_atual text; v_admin boolean := public.is_admin();
BEGIN
  IF p_company_id IS NOT NULL AND NOT v_admin AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  v_q := websearch_to_tsquery('portuguese', COALESCE(p_termo,''));
  IF v_q IS NULL OR numnode(v_q) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'termo', p_termo, 'resultados', '[]'::jsonb);
  END IF;
  IF p_rota_atual IS NOT NULL THEN
    SELECT area INTO v_vert_atual FROM system_screens WHERE rota = p_rota_atual LIMIT 1;
  END IF;

  SELECT jsonb_agg(x ORDER BY (x->>'score')::numeric DESC)
    INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'artigo_id', a.id, 'titulo', a.titulo, 'resumo', a.resumo, 'rota_ref', a.rota_ref,
      'vertical', a.vertical, 'fonte', a.fonte,
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
    LIMIT 20
  ) t;

  RETURN jsonb_build_object('ok', true, 'termo', p_termo, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_ajuda_buscar(uuid, text, text, int) TO authenticated;

-- ── 2.2 registrar uso (👍/👎 + gaps) ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ajuda_registrar_uso(p_company_id uuid, p_pergunta text, p_resolveu boolean, p_artigo_id uuid DEFAULT NULL, p_rota text DEFAULT NULL, p_papel int DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_company_id IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso');
  END IF;
  INSERT INTO erp_ajuda_uso (company_id, user_id, pergunta, resolveu, artigo_id, rota, papel)
  VALUES (p_company_id, auth.uid(), NULLIF(btrim(p_pergunta),''), p_resolveu, p_artigo_id, p_rota, p_papel)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_ajuda_registrar_uso(uuid, text, boolean, uuid, text, int) TO authenticated;
