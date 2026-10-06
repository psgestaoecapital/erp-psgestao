-- Produtividade Fase 2 (MVP) · kg por homem-hora por setor e dia. Aditivo: tabela nova + 2 funcoes novas.
-- Numerador = ind_atak_fato dominio producao_frigorifico, perfis PCP0301/PCP0302 (producao de desossa), QTDE_KG,
-- por DATA_ESTOQUE. NAO usa desossa_rendimento (linhas explodidas por materia-prima: ~3x o kg real, provado 01-05/10).
-- Dia com <5 pessoas no ponto = sem dado (3/10: 3 pessoas x 37 mil kg nao casa).
-- Denominador = ind_ponto_dia.worked_seconds/3600 por department. Setor sem producao medida em kg => kg_hh nulo ("sem dado").
CREATE TABLE IF NOT EXISTS public.prod_indicador_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  setor text NOT NULL,
  meta_kg_hh numeric NOT NULL CHECK (meta_kg_hh > 0),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, setor)
);
ALTER TABLE public.prod_indicador_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_indicador_meta_empresa ON public.prod_indicador_meta;
CREATE POLICY prod_indicador_meta_empresa ON public.prod_indicador_meta FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.prod_indicador_meta FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.prod_indicador_meta TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_prod_indicadores(p_company_id uuid, p_de date, p_ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb; v_metas jsonb;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 120 THEN RAISE EXCEPTION 'periodo_invalido'; END IF;
  WITH kg AS (
    SELECT (f.raw->>'DATA_ESTOQUE')::timestamptz::date AS dia, sum((f.raw->>'QTDE_KG')::numeric) AS kg
      FROM public.ind_atak_fato f
     WHERE f.company_id = p_company_id AND f.dominio = 'producao_frigorifico'
       AND f.raw->>'PERFIL_TMV' IN ('PCP0301','PCP0302')
       AND f.raw->>'DATA_ESTOQUE' >= p_de::text AND f.raw->>'DATA_ESTOQUE' < (p_ate + 1)::text
     GROUP BY 1
  ), pt AS (
    SELECT d.department AS setor, d.data AS dia, count(DISTINCT d.cpf) FILTER (WHERE d.worked_seconds > 0) AS pessoas,
           round(sum(d.worked_seconds) / 3600.0, 2) AS horas
      FROM public.ind_ponto_dia d
     WHERE d.company_id = p_company_id AND d.data BETWEEN p_de AND p_ate AND d.department IS NOT NULL
     GROUP BY 1, 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'setor', pt.setor, 'dia', pt.dia, 'pessoas', pt.pessoas, 'horas', pt.horas,
      'kg', CASE WHEN pt.setor = 'DESOSSA' THEN round(kg.kg, 1) END,
      'kg_hh', CASE WHEN pt.setor = 'DESOSSA' AND pt.horas > 0 AND pt.pessoas >= 5 THEN round(kg.kg / pt.horas, 2) END,
      'motivo_sem_dado', CASE WHEN pt.setor <> 'DESOSSA' THEN 'sem producao medida em kg' WHEN pt.pessoas < 5 THEN 'ponto com menos de 5 pessoas (producao do dia nao casa com o ponto)' WHEN kg.kg IS NULL THEN 'sem producao no ATAK' END
    ) ORDER BY pt.setor, pt.dia), '[]'::jsonb) INTO v_rows
    FROM pt LEFT JOIN kg ON kg.dia = pt.dia;
  SELECT COALESCE(jsonb_object_agg(setor, meta_kg_hh), '{}'::jsonb) INTO v_metas FROM public.prod_indicador_meta WHERE company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'linhas', v_rows, 'metas', v_metas,
    'fonte', 'ATAK producao_frigorifico (PCP0301/PCP0302, QTDE_KG, DATA_ESTOQUE) ÷ ponto (worked_seconds)',
    'setores_com_producao', jsonb_build_array('DESOSSA'));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_prod_indicador_meta_salvar(p_company_id uuid, p_setor text, p_meta numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF p_setor IS NULL OR btrim(p_setor) = '' THEN RAISE EXCEPTION 'setor_invalido'; END IF;
  IF p_meta IS NULL THEN
    DELETE FROM public.prod_indicador_meta WHERE company_id = p_company_id AND setor = p_setor;
  ELSE
    INSERT INTO public.prod_indicador_meta (company_id, setor, meta_kg_hh, atualizado_por) VALUES (p_company_id, p_setor, p_meta, auth.uid())
    ON CONFLICT (company_id, setor) DO UPDATE SET meta_kg_hh = EXCLUDED.meta_kg_hh, atualizado_por = auth.uid(), atualizado_em = now();
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_indicadores(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_prod_indicador_meta_salvar(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicadores(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicador_meta_salvar(uuid, text, numeric) TO authenticated;
