-- Produtividade Fase 2 (MVP) · kg por homem-hora por setor e dia. Aditivo: tabela nova + 2 funcoes novas.
-- Numerador = ind_atak_fato dominio producao_frigorifico, QTDE_KG (Desossa: base selecionavel PCP0302 [padrao] | PCP0301+PCP0302 | PCP0301/F630; Abate ABT0103/F210),
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

CREATE OR REPLACE FUNCTION public.fn_prod_indicadores(p_company_id uuid, p_de date, p_ate date, p_setor text DEFAULT NULL, p_base text DEFAULT 'PCP0302')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_perfis text[]; v_tmv text; v_base_txt text;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 120 THEN RAISE EXCEPTION 'periodo_invalido'; END IF;
  -- "Base do kg" da DESOSSA (a Frioeste define a definitiva na reuniao de 07/10): 3 opcoes.
  IF p_base IS NULL OR p_base = 'PCP0302' THEN v_perfis := ARRAY['PCP0302']; v_tmv := NULL; v_base_txt := 'Producao da desossa (PCP0302)';
  ELSIF p_base = 'PCP0301+PCP0302' THEN v_perfis := ARRAY['PCP0301','PCP0302']; v_tmv := NULL; v_base_txt := 'Tudo que passa na desossa (PCP0301 + PCP0302)';
  ELSIF p_base = 'PCP0301_F630' THEN v_perfis := ARRAY['PCP0301']; v_tmv := 'F630'; v_base_txt := 'So produto acabado (PCP0301 / F630)';
  ELSE RAISE EXCEPTION 'base_invalida'; END IF;
  WITH setores(setor, ordem, depts, perfis, tmv) AS (VALUES
    ('DESOSSA', 1, ARRAY['DESOSSA'], v_perfis, v_tmv),
    ('ABATE',   2, ARRAY['ABATE','DESCARGA E ABATE','BALANÇA DE CARCAÇAS'], ARRAY['ABT0103'], 'F210')),
  alvo AS (SELECT * FROM setores WHERE p_setor IS NULL OR setor = p_setor),
  ponto AS (
    SELECT a.setor, d.data, count(DISTINCT d.cpf) FILTER (WHERE d.worked_seconds > 0) AS pessoas,
           round(sum(d.worked_seconds) / 3600.0, 2) AS horas,
           round(sum(greatest(d.worked_seconds - 8*3600, 0)) / 3600.0, 2) AS horas_extras
      FROM public.ind_ponto_dia d JOIN alvo a ON upper(d.department) = ANY(a.depts)
     WHERE d.company_id = p_company_id AND d.data BETWEEN p_de AND p_ate
     GROUP BY 1, 2),
  prod AS (
    SELECT a.setor, left(f.raw->>'DATA_ESTOQUE', 10)::date AS data, round(sum((f.raw->>'QTDE_KG')::numeric), 1) AS kg
      FROM public.ind_atak_fato f
      JOIN alvo a ON f.raw->>'PERFIL_TMV' = ANY(a.perfis) AND (a.tmv IS NULL OR f.raw->>'COD_TIPO_MV' = a.tmv)
     WHERE f.company_id = p_company_id AND f.dominio = 'producao_frigorifico'
       AND f.raw->>'DATA_ESTOQUE' >= p_de::text AND f.raw->>'DATA_ESTOQUE' < (p_ate + 1)::text
     GROUP BY 1, 2),
  dias AS (SELECT a.setor, g::date AS data FROM alvo a, generate_series(p_de, p_ate, interval '1 day') g),
  linha AS (
    SELECT d.setor, d.data, p.kg, t.pessoas, t.horas, t.horas_extras,
           CASE WHEN p.kg IS NOT NULL AND t.pessoas >= 5 AND t.horas / t.pessoas >= 4 THEN round(p.kg / t.horas, 2) END AS kg_hh
      FROM dias d LEFT JOIN prod p USING (setor, data) LEFT JOIN ponto t USING (setor, data)
     WHERE p.kg IS NOT NULL OR t.horas IS NOT NULL)
  SELECT jsonb_build_object('ok', true, 'inicio', p_de, 'fim', p_ate, 'base', COALESCE(p_base, 'PCP0302'), 'base_texto', v_base_txt,
    'fonte', 'ATAK producao_frigorifico (QTDE_KG, DATA_ESTOQUE) ÷ ponto (worked_seconds)',
    'lacunas', jsonb_build_array(
      'Faltas: o ponto so registra dia trabalhado — sem dado de falta.',
      'Turno: a producao do ATAK nao traz turno — comparacao entre turnos fica para a proxima fase.',
      'Cabecas→kg: sem conversao cadastrada; so setores medidos em kg (Desossa e Abate).',
      'Demais setores: sem producao em kg vinculada — sem dado.',
      'Dia incompleto (menos de 5 pessoas ou media abaixo de 4h por pessoa) nao entra no kg/homem-hora.',
      'Horas extras = horas trabalhadas acima de 8h por pessoa/dia.'),
    'setores', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'setor', a.setor,
        'meta_kg_hh', (SELECT m.meta_kg_hh FROM public.prod_indicador_meta m WHERE m.company_id = p_company_id AND m.setor = a.setor),
        'kg', (SELECT sum(kg) FROM linha l WHERE l.setor = a.setor AND l.kg_hh IS NOT NULL),
        'horas', (SELECT sum(horas) FROM linha l WHERE l.setor = a.setor AND l.kg_hh IS NOT NULL),
        'horas_extras', (SELECT sum(horas_extras) FROM linha l WHERE l.setor = a.setor),
        'pessoas_media', (SELECT round(avg(pessoas), 1) FROM linha l WHERE l.setor = a.setor AND pessoas IS NOT NULL),
        'dias_medidos', (SELECT count(*) FROM linha l WHERE l.setor = a.setor AND l.kg_hh IS NOT NULL),
        'kg_hh', (SELECT round(sum(kg) / nullif(sum(horas), 0), 2) FROM linha l WHERE l.setor = a.setor AND l.kg_hh IS NOT NULL),
        'dias', COALESCE((SELECT jsonb_agg(jsonb_build_object('data', l.data, 'kg', l.kg, 'pessoas', l.pessoas, 'horas', l.horas,
                   'horas_extras', l.horas_extras, 'kg_hh', l.kg_hh,
                   'motivo_sem_dado', CASE WHEN l.kg_hh IS NOT NULL THEN NULL WHEN l.kg IS NULL THEN 'sem producao no ATAK'
                     WHEN l.pessoas IS NULL THEN 'sem ponto' ELSE 'ponto incompleto (menos de 5 pessoas ou menos de 4h por pessoa)' END) ORDER BY l.data)
                 FROM linha l WHERE l.setor = a.setor), '[]'::jsonb)
      ) ORDER BY a.ordem) FROM alvo a), '[]'::jsonb))
  INTO v_res;
  RETURN v_res;
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

REVOKE ALL ON FUNCTION public.fn_prod_indicadores(uuid, date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_prod_indicador_meta_salvar(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicadores(uuid, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicador_meta_salvar(uuid, text, numeric) TO authenticated;
