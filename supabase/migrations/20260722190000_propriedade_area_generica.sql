-- PARTE 1 — Área genérica da propriedade (multi-atividade). Aditivo (NÃO dropa erp_pec_area).
-- Nada hardcoded de propriedade: uso/linha/posse são cadastráveis. RD-41 · RD-54 (backup) · RD-55.

-- backup precaucional das 23 áreas (RD-54)
CREATE SCHEMA IF NOT EXISTS bkp_areas_20260722;
CREATE TABLE IF NOT EXISTS bkp_areas_20260722.erp_pec_area AS TABLE public.erp_pec_area;

CREATE TABLE IF NOT EXISTS public.erp_propriedade_area (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  propriedade_id uuid NOT NULL REFERENCES public.erp_pec_propriedade(id),
  nome text NOT NULL,
  uso text NOT NULL CHECK (uso IN (
    'pastagem','lavoura','silvicultura','aquicultura',
    'benfeitoria','reserva_legal','app','infraestrutura','outro')),
  area_ha numeric(12,2) NOT NULL CHECK (area_ha > 0),
  business_line_id uuid NULL REFERENCES public.business_lines(id),  -- NULL = não alocada (comum)
  entra_rateio boolean NOT NULL DEFAULT true,
  capacidade_ua numeric(10,2) NULL,                                 -- só quando uso='pastagem'
  posse text NOT NULL DEFAULT 'propria'
    CHECK (posse IN ('propria','arrendada_de','arrendada_para','parceria')),
  contraparte text NULL,
  contrato_ref text NULL,
  geo jsonb NULL,                                                   -- GeoJSON (mapa futuro / Perfarm)
  ativo boolean NOT NULL DEFAULT true,
  ref_externa_sistema text NULL,
  ref_externa_id text NULL,
  observacao text NULL,
  criado_por uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prop_area ON public.erp_propriedade_area (company_id, propriedade_id, uso);

ALTER TABLE public.erp_propriedade_area ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_prop_area ON public.erp_propriedade_area
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 1.2 Copia as 23 áreas preservando o id (senão quebra area_atual_id de animal/lote/movimentacao
-- quando, numa fase futura, erp_pec_area virar view). uso='pastagem' (eram piquetes).
INSERT INTO public.erp_propriedade_area
  (id, company_id, propriedade_id, nome, uso, area_ha, capacidade_ua, posse, contraparte,
   ativo, ref_externa_sistema, ref_externa_id, observacao, criado_por, created_at, updated_at)
SELECT
  a.id, a.company_id, a.propriedade_id, a.nome, 'pastagem',
  COALESCE(a.area_ha, 0.01),                    -- area_ha é NOT NULL >0 na nova; guarda contra null/0
  a.capacidade_ua,
  CASE WHEN a.arrendada_para IS NOT NULL AND btrim(a.arrendada_para) <> '' THEN 'arrendada_para' ELSE 'propria' END,
  NULLIF(a.arrendada_para, ''),
  a.ativo, a.ref_externa_sistema, a.ref_externa_id, a.observacao, a.criado_por, a.created_at, a.updated_at
FROM public.erp_pec_area a
ON CONFLICT (id) DO NOTHING;
