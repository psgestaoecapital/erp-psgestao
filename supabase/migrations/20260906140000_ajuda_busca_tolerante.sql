-- ============================================================
-- #28 · Central de Ajuda: busca em dois estagios
-- ============================================================
-- Auditoria (06/09/2026): o caminho esta ligado (fn_ajuda_buscar responde 200), mas a busca e
-- exigente demais. websearch_to_tsquery liga os lexemas com AND: "como cadastrar novo cliente"
-- vira "cadastr & client & nov" e nenhum dos 155 artigos publicados casa os tres -> zero resultados.
-- Correcao: dois estagios. Estagio 1 tenta AND (preciso). Se vier vazio, refaz com OR sobre os
-- mesmos lexemas (modo 'ampliado') e o boost de contexto (rota/vertical) pesa mais, porque o ruido
-- do OR sobe. O ts_rank continua ordenando; nada de relevancia inventada. Mesmo tratamento no RAG,
-- para a IA receber contexto em vez de vazio.

-- 3.1 helper: monta tsquery OR a partir dos lexemas do termo
CREATE OR REPLACE FUNCTION public.fn_ajuda_tsquery_ampliado(p_termo text)
 RETURNS tsquery
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(string_agg(DISTINCT lexeme, ' | '), '')::tsquery
    FROM unnest(to_tsvector('portuguese', COALESCE(p_termo, '')));
$function$;
COMMENT ON FUNCTION public.fn_ajuda_tsquery_ampliado(text) IS
  'Lexemas do termo ligados por OR. Usado como 2o estagio quando a busca AND nao acha nada (#28).';

-- 3.2 busca em dois estagios
CREATE OR REPLACE FUNCTION public.fn_ajuda_buscar(
  p_company_id uuid, p_termo text, p_rota_atual text DEFAULT NULL::text, p_papel integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q tsquery; v_out jsonb; v_vert_atual text;
  v_admin boolean := public.is_admin();
  v_modo text := 'preciso'; v_boost_rota numeric := 1.0; v_boost_vert numeric := 0.2;
BEGIN
  IF p_company_id IS NOT NULL AND NOT v_admin
     AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  v_q := websearch_to_tsquery('portuguese', COALESCE(p_termo, ''));
  IF v_q IS NULL OR numnode(v_q) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'termo', p_termo, 'modo', 'vazio',
                              'resultados', '[]'::jsonb);
  END IF;
  IF p_rota_atual IS NOT NULL THEN
    SELECT area INTO v_vert_atual FROM system_screens WHERE rota = p_rota_atual LIMIT 1;
  END IF;
  -- ESTAGIO 1 · AND (preciso)
  IF NOT EXISTS (
    SELECT 1 FROM erp_ajuda_artigo a
     WHERE a.status = 'publicado' AND a.search_tsv @@ v_q
       AND (a.company_id IS NULL OR a.company_id = p_company_id)
       AND (v_admin OR a.papel_min <= COALESCE(p_papel, 1))
  ) THEN
    -- ESTAGIO 2 · OR (ampliado). Contexto pesa mais porque o ruido sobe.
    v_q := public.fn_ajuda_tsquery_ampliado(p_termo);
    v_modo := 'ampliado'; v_boost_rota := 1.5; v_boost_vert := 0.5;
  END IF;
  IF v_q IS NULL OR numnode(v_q) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'termo', p_termo, 'modo', 'vazio',
                              'resultados', '[]'::jsonb);
  END IF;
  SELECT jsonb_agg(x ORDER BY (x->>'score')::numeric DESC) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'artigo_id', a.id, 'titulo', a.titulo, 'resumo', a.resumo, 'rota_ref', a.rota_ref,
      'vertical', a.vertical, 'fonte', a.fonte, 'atualizado_em', a.atualizado_em,
      'score', round((ts_rank(a.search_tsv, v_q)
        + CASE WHEN p_rota_atual IS NOT NULL AND a.rota_ref = p_rota_atual THEN v_boost_rota
               WHEN v_vert_atual IS NOT NULL AND a.vertical = v_vert_atual THEN v_boost_vert
               ELSE 0 END)::numeric, 4)
    ) AS x
    FROM erp_ajuda_artigo a
    WHERE a.status = 'publicado' AND a.search_tsv @@ v_q
      AND (a.company_id IS NULL OR a.company_id = p_company_id)
      AND (v_admin OR a.papel_min <= COALESCE(p_papel, 1))
    ORDER BY ts_rank(a.search_tsv, v_q) DESC
    LIMIT 20
  ) t;
  RETURN jsonb_build_object('ok', true, 'termo', p_termo, 'modo', v_modo,
                            'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;

-- 3.3 mesmo tratamento no RAG (a IA precisa receber contexto, nao vazio)
CREATE OR REPLACE FUNCTION public.fn_ajuda_rag_contexto(
  p_company_id uuid, p_termo text, p_rota_atual text DEFAULT NULL::text,
  p_papel integer DEFAULT 1, p_k integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q tsquery; v_out jsonb; v_vert_atual text;
  v_admin boolean := public.is_admin();
  v_boost_rota numeric := 1.0; v_boost_vert numeric := 0.2;
BEGIN
  IF p_company_id IS NOT NULL AND NOT v_admin
     AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  v_q := websearch_to_tsquery('portuguese', COALESCE(p_termo, ''));
  IF v_q IS NULL OR numnode(v_q) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'resultados', '[]'::jsonb);
  END IF;
  IF p_rota_atual IS NOT NULL THEN
    SELECT area INTO v_vert_atual FROM system_screens WHERE rota = p_rota_atual LIMIT 1;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM erp_ajuda_artigo a
     WHERE a.status = 'publicado' AND a.search_tsv @@ v_q
       AND (a.company_id IS NULL OR a.company_id = p_company_id)
       AND (v_admin OR a.papel_min <= COALESCE(p_papel, 1))
  ) THEN
    v_q := public.fn_ajuda_tsquery_ampliado(p_termo);
    v_boost_rota := 1.5; v_boost_vert := 0.5;
  END IF;
  IF v_q IS NULL OR numnode(v_q) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'resultados', '[]'::jsonb);
  END IF;
  SELECT jsonb_agg(x ORDER BY (x->>'score')::numeric DESC) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'artigo_id', a.id, 'titulo', a.titulo, 'resumo', a.resumo, 'corpo_md', a.corpo_md,
      'rota_ref', a.rota_ref, 'vertical', a.vertical,
      'atualizado_em', a.atualizado_em, 'fonte', a.fonte,
      'score', round((ts_rank(a.search_tsv, v_q)
        + CASE WHEN p_rota_atual IS NOT NULL AND a.rota_ref = p_rota_atual THEN v_boost_rota
               WHEN v_vert_atual IS NOT NULL AND a.vertical = v_vert_atual THEN v_boost_vert
               ELSE 0 END)::numeric, 4)
    ) AS x
    FROM erp_ajuda_artigo a
    WHERE a.status = 'publicado' AND a.search_tsv @@ v_q
      AND (a.company_id IS NULL OR a.company_id = p_company_id)
      AND (v_admin OR a.papel_min <= COALESCE(p_papel, 1))
    ORDER BY ts_rank(a.search_tsv, v_q) DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_k, 5), 10))
  ) t;
  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $function$;
