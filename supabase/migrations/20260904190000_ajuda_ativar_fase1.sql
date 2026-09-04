-- Ajuda por IA · Fase 1 — LIGAR o que já existe (ideia da Jordana, SPEC do Engenheiro Chefe 04/09).
-- Auditoria (RD-38): a Central de Ajuda com RAG JÁ ESTÁ NO AR — o botão "?" do cabeçalho abre o
-- AjudaWidget, que chama /api/ajuda/perguntar (RETRIEVE fn_ajuda_rag_contexto → CACHE → Claude Haiku
-- ancorado só nos artigos → telemetria). O que faltava para fechar os aceites da SPEC:
--   (2) a resposta CITAR A DATA do artigo — o RAG não devolvia atualizado_em;
--   (7) o botão "isso não está certo" precisar de um jeito de MANDAR o artigo pra curadoria.
-- Este migration entrega só essas duas peças de banco. A ponte pro chamado (aceites 4/5) usa a RPC
-- que já existe (fn_sugestao_criar) — é frontend, não precisa de banco novo.

-- ── 1. RAG devolve a DATA (e a fonte) do artigo, pra tela mostrar "atualizado em DD/MM" (SPEC §4/§6.2)
-- Corpo idêntico ao vivo (mesma assinatura/retorno) — só acrescenta 'atualizado_em' e 'fonte' no JSON.
CREATE OR REPLACE FUNCTION public.fn_ajuda_rag_contexto(
  p_company_id uuid, p_termo text, p_rota_atual text DEFAULT NULL::text,
  p_papel integer DEFAULT 1, p_k integer DEFAULT 5)
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
      'atualizado_em', a.atualizado_em, 'fonte', a.fonte,   -- NOVO (SPEC §4 defesa 1): o usuário julga a idade
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

-- ── 2. "Isso não está certo" → manda o artigo pra CURADORIA (SPEC §4 defesa 2 / aceite 7).
-- A fila já existe: fn_ajuda_curadoria_listar(p_so_needs_human => true) lê erp_ajuda_artigo.needs_human.
-- Faltava um jeito do usuário FINAL sinalizar. Esta RPC marca needs_human=true (não silencia o artigo —
-- ele segue respondendo; só entra na fila do PS pra revisão) e registra o sinal em erp_ajuda_uso
-- (resolveu=false) pra deixar rastro de QUEM apontou e em QUE pergunta. Qualquer usuário autenticado
-- pode reportar; só marca artigo publicado e global (company_id IS NULL) — o acervo é compartilhado.
CREATE OR REPLACE FUNCTION public.fn_ajuda_artigo_reportar(
  p_artigo_id uuid, p_company_id uuid DEFAULT NULL, p_pergunta text DEFAULT NULL,
  p_rota text DEFAULT NULL, p_papel integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_upd int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_usuario'); END IF;
  IF p_artigo_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_artigo'); END IF;

  UPDATE erp_ajuda_artigo
     SET needs_human = true
   WHERE id = p_artigo_id AND status = 'publicado' AND company_id IS NULL;
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;

  -- rastro: um "não resolveu" apontando o artigo — alimenta erp_ajuda_uso (mesma trilha do 👎).
  INSERT INTO erp_ajuda_uso (company_id, user_id, pergunta, resolveu, artigo_id, rota, papel)
  VALUES (p_company_id, auth.uid(), NULLIF(btrim(p_pergunta),''), false, p_artigo_id, p_rota, p_papel);

  RETURN jsonb_build_object('ok', true, 'reportado', true);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_artigo_reportar(uuid, uuid, text, text, integer) TO authenticated;
