-- RD-41 · Central de Ajuda · F0 Fatia 4 (curadoria IA offline + revisão humana). Depende de #873.
-- IA rascunha (grounded, com [VERIFICAR] onde falta info — RD-51/58); HUMANO publica. Batch offline
-- (RD-42): o motor é a API route /api/ajuda/curar (admin), não runtime de usuário.

-- Backup (RD-55) — tabela pequena (seed global), reversível.
CREATE TABLE IF NOT EXISTS public._backup_ajuda_artigo_20260805 AS SELECT * FROM public.erp_ajuda_artigo;

-- Parte A · rastreio de curadoria
ALTER TABLE public.erp_ajuda_artigo
  ADD COLUMN IF NOT EXISTS curado_por_ia     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS curado_em         timestamptz NULL,
  ADD COLUMN IF NOT EXISTS corpo_md_anterior text NULL,
  ADD COLUMN IF NOT EXISTS needs_human       boolean DEFAULT false;

-- Fila de curadoria (grounded): artigos ainda não curados; junta o material da tela (system_screens).
-- Prioridade: publicados curtos primeiro, gaps por último (só se p_incluir_gaps). Admin-only.
CREATE OR REPLACE FUNCTION public.fn_ajuda_curadoria_fila(p_limite int DEFAULT 20, p_incluir_gaps boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só administrador'); END IF;
  SELECT jsonb_agg(j) INTO v_out FROM (
    SELECT jsonb_build_object(
      'artigo_id', a.id, 'rota', a.rota_ref, 'area', a.vertical, 'titulo', a.titulo,
      'corpo_atual', a.corpo_md, 'is_gap', a.is_gap,
      'contexto', jsonb_build_object(
        'descricao_funcional', s.descricao_funcional,
        'rpcs_chamadas', s.rpcs_chamadas, 'views_consumidas', s.views_consumidas,
        'componentes_principais', s.componentes_principais, 'area', s.area, 'modulo', s.modulo)
    ) AS j
    FROM erp_ajuda_artigo a
    LEFT JOIN system_screens s ON s.rota = a.rota_ref
    WHERE a.fonte='system_screens' AND a.company_id IS NULL AND NOT a.curado_por_ia
      AND (a.status='publicado' OR (p_incluir_gaps AND a.is_gap))
    ORDER BY a.is_gap, length(coalesce(a.corpo_md,''))
    LIMIT GREATEST(1, LEAST(p_limite, 200))
  ) t;
  RETURN jsonb_build_object('ok', true, 'itens', COALESCE(v_out, '[]'::jsonb));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_curadoria_fila(int, boolean) TO authenticated;

-- Aplica o rascunho da IA: preserva o texto original (corpo_md_anterior, só na 1ª vez), grava o novo,
-- marca curado_por_ia + needs_human, e volta pra 'rascunho' (não publica sozinha). Admin-only.
CREATE OR REPLACE FUNCTION public.fn_ajuda_curar_aplicar(p_artigo_id uuid, p_corpo_md text, p_needs_human boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_novo text := NULLIF(btrim(p_corpo_md), '');
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só administrador'); END IF;
  UPDATE erp_ajuda_artigo SET
    corpo_md_anterior = COALESCE(corpo_md_anterior, corpo_md),
    corpo_md          = v_novo,
    resumo            = COALESCE(NULLIF(split_part(coalesce(v_novo,''), E'\n', 1), ''), resumo),
    curado_por_ia     = true,
    curado_em         = now(),
    needs_human       = COALESCE(p_needs_human, false),
    is_gap            = CASE WHEN v_novo IS NOT NULL THEN false ELSE is_gap END,
    status            = 'rascunho',
    atualizado_em     = now()
  WHERE id = p_artigo_id AND fonte='system_screens';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Artigo não encontrado'); END IF;
  RETURN jsonb_build_object('ok', true, 'artigo_id', p_artigo_id, 'status', 'rascunho');
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_curar_aplicar(uuid, text, boolean) TO authenticated;

-- Editar o corpo antes de publicar (curador ajusta o rascunho). Admin-only.
CREATE OR REPLACE FUNCTION public.fn_ajuda_artigo_salvar_corpo(p_artigo_id uuid, p_corpo_md text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_novo text := NULLIF(btrim(p_corpo_md), '');
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só administrador'); END IF;
  UPDATE erp_ajuda_artigo SET
    corpo_md_anterior = COALESCE(corpo_md_anterior, corpo_md),
    corpo_md = v_novo,
    resumo = COALESCE(NULLIF(split_part(coalesce(v_novo,''), E'\n', 1), ''), resumo),
    atualizado_em = now()
  WHERE id = p_artigo_id AND fonte='system_screens';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Artigo não encontrado'); END IF;
  RETURN jsonb_build_object('ok', true, 'artigo_id', p_artigo_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_artigo_salvar_corpo(uuid, text) TO authenticated;

-- Publicar (humano no loop). Admin-only.
CREATE OR REPLACE FUNCTION public.fn_ajuda_artigo_publicar(p_artigo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só administrador'); END IF;
  UPDATE erp_ajuda_artigo SET status='publicado', needs_human=false, atualizado_em=now()
  WHERE id=p_artigo_id AND fonte='system_screens' AND NULLIF(btrim(coalesce(corpo_md,'')),'') IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Artigo vazio ou inexistente — não publica sem conteúdo'); END IF;
  RETURN jsonb_build_object('ok', true, 'artigo_id', p_artigo_id, 'status', 'publicado');
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_artigo_publicar(uuid) TO authenticated;

-- Descartar a curadoria: restaura o texto anterior (RD-55). Admin-only.
CREATE OR REPLACE FUNCTION public.fn_ajuda_artigo_descartar(p_artigo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só administrador'); END IF;
  UPDATE erp_ajuda_artigo SET
    corpo_md          = corpo_md_anterior,
    is_gap            = (NULLIF(btrim(coalesce(corpo_md_anterior,'')),'') IS NULL),
    status            = CASE WHEN NULLIF(btrim(coalesce(corpo_md_anterior,'')),'') IS NOT NULL THEN 'publicado' ELSE 'rascunho' END,
    corpo_md_anterior = NULL,
    curado_por_ia     = false,
    curado_em         = NULL,
    needs_human       = false,
    atualizado_em     = now()
  WHERE id=p_artigo_id AND fonte='system_screens';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Artigo não encontrado'); END IF;
  RETURN jsonb_build_object('ok', true, 'artigo_id', p_artigo_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_artigo_descartar(uuid) TO authenticated;

-- Lista pra tela de revisão + progresso. Admin-only.
CREATE OR REPLACE FUNCTION public.fn_ajuda_curadoria_listar(p_vertical text DEFAULT NULL, p_so_needs_human boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_itens jsonb; v_stats jsonb;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Só administrador'); END IF;
  SELECT jsonb_agg(j ORDER BY (j->>'needs_human')::boolean DESC, j->>'vertical', j->>'titulo') INTO v_itens FROM (
    SELECT jsonb_build_object(
      'artigo_id', a.id, 'titulo', a.titulo, 'vertical', a.vertical, 'rota_ref', a.rota_ref,
      'corpo_md', a.corpo_md, 'corpo_md_anterior', a.corpo_md_anterior,
      'needs_human', a.needs_human, 'is_gap', a.is_gap, 'curado_em', a.curado_em
    ) AS j
    FROM erp_ajuda_artigo a
    WHERE a.fonte='system_screens' AND a.curado_por_ia AND a.status='rascunho'
      AND (p_vertical IS NULL OR a.vertical = p_vertical)
      AND (NOT p_so_needs_human OR a.needs_human)
  ) t;
  SELECT jsonb_build_object(
    'total', count(*), 'publicados', count(*) FILTER (WHERE status='publicado'),
    'rascunho_curado', count(*) FILTER (WHERE curado_por_ia AND status='rascunho'),
    'needs_human', count(*) FILTER (WHERE needs_human), 'gaps', count(*) FILTER (WHERE is_gap)
  ) INTO v_stats FROM erp_ajuda_artigo WHERE fonte='system_screens';
  RETURN jsonb_build_object('ok', true, 'itens', COALESCE(v_itens, '[]'::jsonb), 'stats', v_stats);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_ajuda_curadoria_listar(text, boolean) TO authenticated;

-- RD-35 · registra a tela de curadoria no catálogo (idempotente).
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/admin/ajuda-curadoria', 'admin', 'Ajuda · Curadoria IA',
  'Tela do curador PS: revisa os rascunhos que a IA gerou para os artigos da Central de Ajuda (diff com o texto anterior, destaque de [VERIFICAR] e needs_human) e publica ou descarta. IA nunca publica sozinha.',
  'central_ajuda', 'pronto'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/admin/ajuda-curadoria');
