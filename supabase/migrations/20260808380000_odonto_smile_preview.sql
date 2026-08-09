-- SPEC · Smile Design Fase 2 — prévia ILUSTRATIVA gerada (Gemini image). RD-56/RD-41/RD-51 · Pilar 1.
-- É simulação motivacional, NÃO resultado real. Feature separada 'ia_smile_preview' (visão, OFF, custo ALTO).
-- A imagem gerada fica marcada `ilustrativo=true` → NUNCA é tratada como foto clínica/registro real.

-- 1) marca a imagem como gerada por IA (ilustrativa)
ALTER TABLE public.erp_odonto_imagem ADD COLUMN IF NOT EXISTS ilustrativo boolean NOT NULL DEFAULT false;

-- 2) catálogo: ia_smile_preview (visão, OFF por padrão, custo alto). Fonte única (#924).
INSERT INTO public.ia_feature_catalogo (feature, tipo, default_habilitado, custo_nivel)
VALUES ('ia_smile_preview', 'visao', false, 'alto')
ON CONFLICT (feature) DO UPDATE SET tipo = EXCLUDED.tipo, default_habilitado = EXCLUDED.default_habilitado, custo_nivel = EXCLUDED.custo_nivel;

-- 3) save de imagem passa a honrar `ilustrativo` do p_dados (default false → callers antigos inalterados).
CREATE OR REPLACE FUNCTION public.fn_odonto_imagem_salvar(p_company_id uuid, p_paciente_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_odonto_paciente WHERE id = p_paciente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'paciente não pertence à empresa'); END IF;
  IF coalesce(btrim(p_dados->>'arquivo_path'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'arquivo ausente'); END IF;
  INSERT INTO erp_odonto_imagem (company_id, paciente_id, arquivo_path, arquivo_nome, mime, tamanho_bytes,
      tipo, dente_fdi, data_imagem, tags, observacao, ilustrativo)
  VALUES (p_company_id, p_paciente_id, btrim(p_dados->>'arquivo_path'),
      coalesce(NULLIF(btrim(p_dados->>'arquivo_nome'),''),'arquivo'),
      NULLIF(btrim(p_dados->>'mime'),''), NULLIF(p_dados->>'tamanho_bytes','')::bigint,
      NULLIF(btrim(p_dados->>'tipo'),''), NULLIF(btrim(p_dados->>'dente_fdi'),''),
      coalesce(NULLIF(btrim(p_dados->>'data_imagem'),'')::date, current_date),
      coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_dados->'tags','[]'::jsonb))), '{}'),
      NULLIF(btrim(p_dados->>'observacao'),''),
      coalesce((p_dados->>'ilustrativo')::boolean, false))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
