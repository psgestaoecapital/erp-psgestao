-- Produtividade Fase 2 (MVP) · kg por homem-hora por setor e dia. Aditiva: tabela e funções NOVAS.
-- Produção = ATAK (ind_atak_fato / producao_frigorifico, raw->>'QTDE_KG', dia = raw->>'DATA_ESTOQUE');
-- horas = ponto (ind_ponto_dia.worked_seconds). Só leitura sobre os fatos; nada é gravado neles.
-- Setores medidos hoje: ABATE (perfil ABT0103 · tipo F210) e DESOSSA (perfil PCP0301 · tipo F630).
-- Setor sem produção medida => kg/h-h NULL ("sem dado"), nunca zero.

CREATE TABLE IF NOT EXISTS public.prod_indicador_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  setor text NOT NULL,
  meta_kgh numeric CHECK (meta_kgh IS NULL OR meta_kgh > 0),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  UNIQUE (company_id, setor)
);
ALTER TABLE public.prod_indicador_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prod_indicador_meta_rw ON public.prod_indicador_meta;
CREATE POLICY prod_indicador_meta_rw ON public.prod_indicador_meta FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.prod_indicador_meta FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.prod_indicador_meta TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_prod_indicador_meta_salvar(p_company_id uuid, p_setor text, p_meta_kgh numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(btrim(p_setor), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_obrigatorio'); END IF;
  IF p_meta_kgh IS NOT NULL AND p_meta_kgh <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'meta_invalida'); END IF;
  INSERT INTO prod_indicador_meta(company_id, setor, meta_kgh, atualizado_por)
  VALUES (p_company_id, upper(btrim(p_setor)), p_meta_kgh, auth.uid())
  ON CONFLICT (company_id, setor) DO UPDATE
     SET meta_kgh = EXCLUDED.meta_kgh, atualizado_em = now(), atualizado_por = auth.uid();
  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_prod_indicadores(p_company_id uuid, p_inicio date, p_fim date, p_setor text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_linhas jsonb; v_metas jsonb; v_setores jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 92 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido'); END IF;

  WITH vp AS (  -- vínculos de ponto: departamento -> setor cadastrado
    SELECT DISTINCT ON (v.chave) v.chave, upper(s.nome) setor
      FROM prod_setor_vinculo v
      JOIN prod_setor s ON s.id = v.setor_id
      JOIN prod_fonte_dados f ON f.id = v.fonte_id AND f.tipo = 'ponto'
     WHERE v.company_id = p_company_id
     ORDER BY v.chave, v.created_at
  ), ponto AS (
    SELECT d.data dia, COALESCE(vp.setor, upper(btrim(d.department))) setor,
           d.cpf, sum(d.worked_seconds) / 3600.0 horas
      FROM ind_ponto_dia d LEFT JOIN vp ON vp.chave = d.department
     WHERE d.company_id = p_company_id AND d.data BETWEEN p_inicio AND p_fim
       AND d.worked_seconds > 0 AND d.department IS NOT NULL
     GROUP BY 1, 2, 3
  ), pt AS (
    SELECT dia, setor, count(*) pessoas, round(sum(horas), 2) horas,
           round(sum(greatest(horas - 8, 0)), 2) horas_extras
      FROM ponto GROUP BY 1, 2
  ), prod AS (
    SELECT (a.raw->>'DATA_ESTOQUE')::timestamptz::date dia,
           CASE a.raw->>'PERFIL_TMV' WHEN 'ABT0103' THEN 'ABATE' ELSE 'DESOSSA' END setor,
           round(sum((a.raw->>'QTDE_KG')::numeric), 1) kg
      FROM ind_atak_fato a
     WHERE a.company_id = p_company_id AND a.dominio = 'producao_frigorifico'
       AND a.raw->>'DATA_ESTOQUE' >= p_inicio::text AND a.raw->>'DATA_ESTOQUE' < (p_fim + 1)::text
       AND ((a.raw->>'PERFIL_TMV' = 'ABT0103' AND a.raw->>'COD_TIPO_MV' = 'F210')
         OR (a.raw->>'PERFIL_TMV' = 'PCP0301' AND a.raw->>'COD_TIPO_MV' = 'F630'))
     GROUP BY 1, 2
  ), j AS (
    SELECT COALESCE(pt.dia, prod.dia) dia, COALESCE(pt.setor, prod.setor) setor,
           pt.pessoas, pt.horas, pt.horas_extras, prod.kg
      FROM pt FULL JOIN prod ON prod.dia = pt.dia AND prod.setor = pt.setor
     WHERE p_setor IS NULL OR COALESCE(pt.setor, prod.setor) = upper(p_setor)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('dia', dia, 'setor', setor, 'pessoas', pessoas,
           'horas', horas, 'horas_extras', horas_extras, 'kg', kg,
           'kgh', CASE WHEN kg > 0 AND horas > 0 THEN round(kg / horas, 2) END) ORDER BY dia, setor), '[]'::jsonb)
    INTO v_linhas FROM j;

  SELECT COALESCE(jsonb_object_agg(setor, meta_kgh), '{}'::jsonb) INTO v_metas
    FROM prod_indicador_meta WHERE company_id = p_company_id AND meta_kgh IS NOT NULL;
  SELECT COALESCE(jsonb_agg(DISTINCT x->>'setor'), '[]'::jsonb) INTO v_setores FROM jsonb_array_elements(v_linhas) x;

  RETURN jsonb_build_object('ok', true, 'inicio', p_inicio, 'fim', p_fim, 'linhas', v_linhas,
    'metas', v_metas, 'setores', v_setores, 'setores_com_producao', jsonb_build_array('ABATE', 'DESOSSA'));
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_indicador_meta_salvar(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_prod_indicadores(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicador_meta_salvar(uuid, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicadores(uuid, date, date, text) TO authenticated, service_role;
