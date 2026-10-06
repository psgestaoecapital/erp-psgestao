-- Produtividade · Fase 2 (MVP) — indicadores por SETOR e por DIA: kg por homem-hora.
-- Fórmula: produção (kg, do vínculo de produção do setor) ÷ horas trabalhadas (ponto, do vínculo de ponto do setor).
-- Só leitura (fn_prod_indicadores) + meta por setor (prod_meta_setor, RLS por empresa). Sem vínculo/produção/ponto = null
-- ("sem dado"), nunca zero inventado. Os vínculos vêm da Fase 1 (prod_setor_vinculo); aqui só se semeia o do setor Desossa
-- da Frioeste (ponto DESOSSA ↔ produção PCP0302), ADITIVO e idempotente.

CREATE TABLE IF NOT EXISTS public.prod_meta_setor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id   uuid NOT NULL,
  setor_id   uuid NOT NULL REFERENCES public.prod_setor(id) ON DELETE CASCADE,
  meta_kg_hh numeric NOT NULL CHECK (meta_kg_hh > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (setor_id)
);
ALTER TABLE public.prod_meta_setor ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='prod_meta_setor' AND policyname='p_prod_meta_setor_tenant') THEN
    CREATE POLICY p_prod_meta_setor_tenant ON public.prod_meta_setor FOR ALL TO authenticated
      USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
      WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
  END IF;
END $$;
REVOKE ALL ON public.prod_meta_setor FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prod_meta_setor TO authenticated;

-- Vínculos do setor Desossa (Frioeste): ponto = DESOSSA, produção = PCP0302 (romaneio de produção de entrada — desossa).
INSERT INTO public.prod_setor_vinculo (company_id, plant_id, setor_id, fonte_id, chave, rotulo)
SELECT s.company_id, s.plant_id, s.id, f.id, x.chave, x.chave
FROM public.prod_setor s
JOIN (VALUES ('ponto','DESOSSA'), ('producao','PCP0302')) AS x(tipo, chave) ON true
JOIN public.prod_fonte_dados f ON f.company_id=s.company_id AND f.plant_id=s.plant_id AND f.tipo=x.tipo
WHERE s.company_id='975365cc-9e5a-4251-9022-68c6bfde10d8' AND s.nome='Desossa'
  AND NOT EXISTS (SELECT 1 FROM public.prod_setor_vinculo v WHERE v.fonte_id=f.id AND v.chave=x.chave);

-- Leitura. Uma passada por tabela (sem função por linha). Período limitado a 92 dias.
CREATE OR REPLACE FUNCTION public.fn_prod_indicadores(p_company uuid, p_inicio date, p_fim date, p_setor uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 92 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido'); END IF;

  WITH st AS (
    SELECT s.id, s.nome, s.plant_id
    FROM prod_setor s
    WHERE s.company_id = p_company AND s.ativo AND (p_setor IS NULL OR s.id = p_setor)
      AND EXISTS (SELECT 1 FROM prod_setor_vinculo sv WHERE sv.setor_id = s.id)
  ),
  vp AS (  -- vínculos de ponto: setor ↔ departamento
    SELECT sv.setor_id, sv.chave FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id = sv.fonte_id
    WHERE f.tipo = 'ponto' AND sv.setor_id IN (SELECT id FROM st)
  ),
  vk AS (  -- vínculos de produção: setor ↔ perfil de movimento
    SELECT sv.setor_id, sv.chave FROM prod_setor_vinculo sv JOIN prod_fonte_dados f ON f.id = sv.fonte_id
    WHERE f.tipo = 'producao' AND sv.setor_id IN (SELECT id FROM st)
  ),
  ponto AS (
    SELECT vp.setor_id, d.data, count(DISTINCT d.cpf) FILTER (WHERE COALESCE(d.worked_seconds,0) > 0) AS pessoas,
           sum(COALESCE(d.worked_seconds,0)) / 3600.0 AS horas,
           sum(GREATEST(COALESCE(d.worked_seconds,0) - 31680, 0)) / 3600.0 AS extras   -- acima de 8h48 (jornada padrão)
    FROM ind_ponto_dia d JOIN vp ON vp.chave = d.department
    WHERE d.company_id = p_company AND d.data BETWEEN p_inicio AND p_fim
    GROUP BY 1, 2
  ),
  prod AS (
    SELECT vk.setor_id, (a.raw->>'DATA_ESTOQUE')::timestamptz::date AS data, sum((a.raw->>'QTDE_KG')::numeric) AS kg
    FROM ind_atak_fato a JOIN vk ON vk.chave = a.raw->>'PERFIL_TMV'
    WHERE a.company_id = p_company AND a.dominio = 'producao_frigorifico'
      AND (a.raw->>'DATA_ESTOQUE') >= p_inicio::text AND (a.raw->>'DATA_ESTOQUE') < (p_fim + 1)::text
    GROUP BY 1, 2
  ),
  dias AS (
    SELECT COALESCE(po.setor_id, pr.setor_id) AS setor_id, COALESCE(po.data, pr.data) AS data,
           po.pessoas, po.horas, po.extras, pr.kg,
           CASE WHEN pr.kg IS NOT NULL AND po.horas > 0 AND po.pessoas >= 5 THEN pr.kg / po.horas END AS kg_hh  -- dia com <5 pessoas no ponto = dado incompleto (ex.: sábado só com produção)
    FROM ponto po FULL JOIN prod pr ON pr.setor_id = po.setor_id AND pr.data = po.data
  ),
  res AS (
    SELECT d.setor_id,
           sum(d.kg) FILTER (WHERE d.kg_hh IS NOT NULL) AS kg, sum(d.horas) FILTER (WHERE d.kg_hh IS NOT NULL) AS horas_casadas,
           sum(d.horas) AS horas, sum(d.extras) AS extras, round(avg(d.pessoas) FILTER (WHERE d.pessoas > 0), 1) AS pessoas_media,
           count(*) FILTER (WHERE d.kg_hh IS NOT NULL) AS dias_medidos
    FROM dias d GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'setor_id', st.id, 'setor', st.nome, 'plant_id', st.plant_id,
      'tem_vinculo_ponto', EXISTS (SELECT 1 FROM vp WHERE vp.setor_id = st.id),
      'tem_vinculo_producao', EXISTS (SELECT 1 FROM vk WHERE vk.setor_id = st.id),
      'meta_kg_hh', (SELECT m.meta_kg_hh FROM prod_meta_setor m WHERE m.setor_id = st.id),
      'resumo', jsonb_build_object(
          'kg', round(r.kg, 1), 'horas', round(r.horas, 1), 'extras_h', round(r.extras, 1), 'pessoas_media', r.pessoas_media,
          'dias_medidos', COALESCE(r.dias_medidos, 0),
          'kg_hh', CASE WHEN r.horas_casadas > 0 THEN round(r.kg / r.horas_casadas, 2) END),
      'dias', COALESCE((SELECT jsonb_agg(jsonb_build_object('data', d.data, 'kg', round(d.kg, 1), 'horas', round(d.horas, 1),
                  'extras_h', round(d.extras, 1), 'pessoas', d.pessoas, 'kg_hh', round(d.kg_hh, 2)) ORDER BY d.data)
                FROM dias d WHERE d.setor_id = st.id), '[]'::jsonb)
    ) ORDER BY st.nome), '[]'::jsonb) INTO v
  FROM st LEFT JOIN res r ON r.setor_id = st.id;

  RETURN jsonb_build_object('ok', true, 'inicio', p_inicio, 'fim', p_fim, 'setores', v);
END $function$;

REVOKE ALL ON FUNCTION public.fn_prod_indicadores(uuid, date, date, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_prod_indicadores(uuid, date, date, uuid) TO authenticated;
