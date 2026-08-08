-- ADDENDUM IA-2.1 · Features de VISÃO são opt-in (default OFF); TEXTO seguem ON. RD-52 (fonte única).
-- Antes: "ausência de linha = ligado" pra TODAS → visão gerava custo sem a clínica optar. Agora o default
-- é POR FEATURE, numa fonte única (ia_feature_catalogo) lida pelo backend E pelo front:
--   enabled(company,feature) = COALESCE(ia_config_empresa.habilitado, ia_feature_catalogo.default_habilitado, true)

-- 1) Catálogo (fonte única do default por feature). Reference data global (não é por tenant).
CREATE TABLE IF NOT EXISTS public.ia_feature_catalogo (
  feature text PRIMARY KEY,
  tipo text NOT NULL DEFAULT 'texto',          -- 'texto' | 'visao'
  default_habilitado boolean NOT NULL DEFAULT true,
  custo_nivel text NOT NULL DEFAULT 'baixo',   -- 'baixo' | 'alto'
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.ia_feature_catalogo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sel_ia_feature_catalogo ON public.ia_feature_catalogo;
CREATE POLICY sel_ia_feature_catalogo ON public.ia_feature_catalogo FOR SELECT TO authenticated USING (true);

-- 2) Seed (idempotente): texto = ON; visão = OFF (opt-in). Novas features de visão entram OFF só aqui.
INSERT INTO public.ia_feature_catalogo (feature, tipo, default_habilitado, custo_nivel) VALUES
  ('resumo_paciente',   'texto', true,  'baixo'),
  ('consultor_clinica', 'texto', true,  'baixo'),
  ('voz_soap',          'texto', true,  'baixo'),
  ('alertas_proativos', 'texto', true,  'baixo'),
  ('orcamento_ia',      'texto', true,  'baixo'),
  ('ia_raiox',          'visao', false, 'alto'),
  ('ia_smile',          'visao', false, 'alto')
ON CONFLICT (feature) DO UPDATE
  SET tipo = EXCLUDED.tipo, default_habilitado = EXCLUDED.default_habilitado, custo_nivel = EXCLUDED.custo_nivel;

-- 3) pode_gastar: default agora vem do catálogo (visão OFF por ausência). Resto igual (#918).
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_pode_gastar(p_company_id uuid, p_feature text, p_custo_estimado numeric DEFAULT 0.01)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_hab boolean; v_lim numeric; v_cons numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('habilitado', false, 'pode', false, 'motivo', 'sem acesso'); END IF;
  SELECT habilitado, limite_diario_usd INTO v_hab, v_lim
    FROM ia_config_empresa WHERE company_id = p_company_id AND feature = p_feature;
  -- DEFAULT POR FEATURE (fonte única): texto → true; visão → false. Feature desconhecida → true.
  v_hab := coalesce(v_hab, (SELECT default_habilitado FROM ia_feature_catalogo WHERE feature = p_feature), true);
  IF NOT v_hab THEN
    RETURN jsonb_build_object('habilitado', false, 'pode', false, 'motivo', 'IA desativada para esta clínica'); END IF;
  v_cons := coalesce((SELECT custo_usd FROM ia_consumo_empresa WHERE company_id = p_company_id AND feature = p_feature AND data_referencia = current_date), 0);
  IF v_lim IS NOT NULL AND (v_cons + coalesce(p_custo_estimado,0)) > v_lim THEN
    RETURN jsonb_build_object('habilitado', true, 'pode', false, 'motivo', 'limite diário da clínica atingido', 'consumo_hoje', v_cons, 'limite', v_lim); END IF;
  RETURN jsonb_build_object('habilitado', true, 'pode', true, 'consumo_hoje', v_cons, 'limite', v_lim);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_pode_gastar(uuid,text,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_pode_gastar(uuid,text,numeric) TO authenticated;

-- 4) Leitura ÚNICA para o front (Config de IA + gating): catálogo LEFT JOIN config → habilitado EFETIVO.
--    habilitado = coalesce(config.habilitado, catalogo.default_habilitado). Assim a UI e o backend concordam.
CREATE OR REPLACE FUNCTION public.fn_ia_empresa_features(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
        'feature', cat.feature, 'tipo', cat.tipo, 'custo_nivel', cat.custo_nivel,
        'default_habilitado', cat.default_habilitado,
        'habilitado', coalesce(cfg.habilitado, cat.default_habilitado),
        'configurado', (cfg.habilitado IS NOT NULL),
        'limite_diario_usd', cfg.limite_diario_usd)
      ORDER BY cat.tipo, cat.feature)
    FROM ia_feature_catalogo cat
    LEFT JOIN ia_config_empresa cfg ON cfg.feature = cat.feature AND cfg.company_id = p_company_id
  ), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ia_empresa_features(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_ia_empresa_features(uuid) TO authenticated;
