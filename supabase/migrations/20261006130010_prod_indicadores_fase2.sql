-- ============================================================
-- Produtividade · Fase 2 (MVP) · kg por homem-hora por SETOR e DIA.
-- Somente leitura (fn_prod_indicadores) + meta editavel por setor (prod_meta_setor, tabela NOVA, RLS).
--   producao = ind_atak_fato (QTDE_KG por DATA_ESTOQUE)  ·  horas = ind_ponto_dia.worked_seconds por departamento.
-- Setores medidos em kg (RD-38, provado em 3 dias reais antes de publicar):
--   DESOSSA : ponto DESOSSA            x ATAK producao_frigorifico PCP0301/F630 (produto acabado, KG)
--   ABATE   : ponto ABATE, DESCARGA E ABATE, BALANCA DE CARCACAS x ATAK producao_frigorifico ABT0103/F210 (carcacas, QTDE_KG)
-- Dia incompleto (<5 pessoas ou <4h/pessoa: fim de semana, hoje com ponto aberto) fica sem kg/hh.
-- Setor sem producao medida em kg = "sem dado" (nunca zero inventado). Faltas: o ponto so grava dia trabalhado -> sem dado.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prod_meta_setor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  setor text NOT NULL,
  meta_kg_hh numeric NOT NULL CHECK (meta_kg_hh > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, setor)
);
ALTER TABLE public.prod_meta_setor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_meta_setor_sel ON public.prod_meta_setor;
CREATE POLICY prod_meta_setor_sel ON public.prod_meta_setor FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.prod_meta_setor FROM anon, public;
GRANT SELECT ON public.prod_meta_setor TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_prod_meta_salvar(p_company_id uuid, p_setor text, p_meta numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_setor IS NULL OR p_setor NOT IN ('DESOSSA','ABATE') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_invalido'); END IF;
  IF p_meta IS NULL THEN  -- sem meta = so mostra o realizado
    DELETE FROM prod_meta_setor WHERE company_id=p_company_id AND setor=p_setor;
    RETURN jsonb_build_object('ok', true, 'meta', NULL); END IF;
  IF p_meta <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'meta_invalida'); END IF;
  INSERT INTO prod_meta_setor(company_id, setor, meta_kg_hh, updated_by)
  VALUES (p_company_id, p_setor, p_meta, auth.uid())
  ON CONFLICT (company_id, setor) DO UPDATE SET meta_kg_hh=EXCLUDED.meta_kg_hh, updated_by=auth.uid(), updated_at=now();
  RETURN jsonb_build_object('ok', true, 'meta', p_meta);
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_meta_salvar(uuid, text, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_meta_salvar(uuid, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_prod_indicadores(p_company_id uuid, p_inicio date, p_fim date, p_setor text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 120 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido'); END IF;

  WITH setores(setor, ordem, depts, perfil, tmv) AS (VALUES
    ('DESOSSA', 1, ARRAY['DESOSSA'], 'PCP0301', 'F630'),
    ('ABATE',   2, ARRAY['ABATE','DESCARGA E ABATE','BALANÇA DE CARCAÇAS'], 'ABT0103', 'F210')),
  alvo AS (SELECT * FROM setores WHERE p_setor IS NULL OR setor = p_setor),
  ponto AS (
    SELECT a.setor, d.data,
           count(DISTINCT d.cpf) pessoas,
           round(sum(d.worked_seconds)/3600.0, 2) horas,
           round(sum(greatest(d.worked_seconds - 8*3600, 0))/3600.0, 2) horas_extras
      FROM ind_ponto_dia d JOIN alvo a ON upper(d.department) = ANY(a.depts)
     WHERE d.company_id = p_company_id AND d.data BETWEEN p_inicio AND p_fim
     GROUP BY a.setor, d.data),
  prod AS (
    SELECT a.setor, left(f.raw->>'DATA_ESTOQUE',10)::date data,
           round(sum((f.raw->>'QTDE_KG')::numeric), 1) kg
      FROM ind_atak_fato f JOIN alvo a ON f.raw->>'PERFIL_TMV' = a.perfil AND f.raw->>'COD_TIPO_MV' = a.tmv
     WHERE f.company_id = p_company_id AND f.dominio = 'producao_frigorifico'
       AND f.raw->>'DATA_ESTOQUE' >= to_char(p_inicio,'YYYY-MM-DD')
       AND f.raw->>'DATA_ESTOQUE' <  to_char(p_fim + 1,'YYYY-MM-DD')
     GROUP BY 1, 2),
  dias AS (
    SELECT a.setor, g::date data FROM alvo a, generate_series(p_inicio, p_fim, interval '1 day') g),
  linha AS (
    SELECT d.setor, d.data, p.kg, t.pessoas, t.horas, t.horas_extras,
           CASE WHEN p.kg IS NOT NULL AND t.pessoas >= 5 AND t.horas / t.pessoas >= 4 THEN round(p.kg / t.horas, 2) END kg_hh
      FROM dias d LEFT JOIN prod p USING (setor, data) LEFT JOIN ponto t USING (setor, data)
     WHERE p.kg IS NOT NULL OR t.horas IS NOT NULL)
  SELECT jsonb_build_object('ok', true, 'inicio', p_inicio, 'fim', p_fim,
    'lacunas', jsonb_build_array(
      'Faltas: o ponto so registra dia trabalhado — sem dado de falta.',
      'Turno: a producao do ATAK nao traz turno (campo TURNO vazio) — comparacao entre turnos fica para a proxima fase.',
      'Cabecas→kg: sem conversao cadastrada; so setores medidos em kg (Desossa e Abate).',
      'Demais setores (Expedicao etc.): sem producao em kg vinculada — sem dado.',
      'Dia incompleto (menos de 5 pessoas ou media abaixo de 4h por pessoa, ex.: sabado ou hoje com ponto aberto) nao entra no kg/homem-hora.',
      'Horas extras = horas trabalhadas acima de 8h por pessoa/dia.'),
    'setores', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'setor', a.setor,
        'fonte_producao', 'ATAK producao_frigorifico · perfil '||a.perfil||' · mov. '||a.tmv||' · QTDE_KG',
        'fonte_ponto', 'ponto (ind_ponto_dia) · departamento '||array_to_string(a.depts, ', '),
        'meta_kg_hh', (SELECT m.meta_kg_hh FROM prod_meta_setor m WHERE m.company_id=p_company_id AND m.setor=a.setor),
        'kg', (SELECT sum(kg) FROM linha l WHERE l.setor=a.setor AND l.kg_hh IS NOT NULL),
        'horas', (SELECT sum(horas) FROM linha l WHERE l.setor=a.setor AND l.kg_hh IS NOT NULL),
        'horas_extras', (SELECT sum(horas_extras) FROM linha l WHERE l.setor=a.setor),
        'pessoas_media', (SELECT round(avg(pessoas),1) FROM linha l WHERE l.setor=a.setor AND pessoas IS NOT NULL),
        'dias_medidos', (SELECT count(*) FROM linha l WHERE l.setor=a.setor AND l.kg_hh IS NOT NULL),
        'kg_hh', (SELECT round(sum(kg)/nullif(sum(horas),0),2) FROM linha l WHERE l.setor=a.setor AND l.kg_hh IS NOT NULL),
        'dias', coalesce((SELECT jsonb_agg(jsonb_build_object('data', l.data, 'kg', l.kg, 'pessoas', l.pessoas,
                   'horas', l.horas, 'horas_extras', l.horas_extras, 'kg_hh', l.kg_hh) ORDER BY l.data)
                 FROM linha l WHERE l.setor=a.setor), '[]'::jsonb)
      ) ORDER BY a.ordem) FROM alvo a), '[]'::jsonb))
  INTO v_res;
  RETURN v_res;
END $function$;
REVOKE ALL ON FUNCTION public.fn_prod_indicadores(uuid, date, date, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicadores(uuid, date, date, text) TO authenticated;
