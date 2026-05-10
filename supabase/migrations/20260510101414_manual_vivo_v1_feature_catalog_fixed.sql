-- Manual Vivo V1: feature_catalog + 4 views (CORRIGIDO - colunas reais plan_catalog)

-- ETAPA 1: Tabela feature_catalog
CREATE TABLE IF NOT EXISTS public.feature_catalog (
  id text PRIMARY KEY,
  module_id text NOT NULL REFERENCES public.module_catalog(id) ON DELETE CASCADE,
  area text NOT NULL,
  titulo text NOT NULL,
  descricao_executiva text NOT NULL,
  descricao_tecnica text,
  status text NOT NULL DEFAULT 'previsto'
    CHECK (status IN ('pronto', 'parcial', 'previsto', 'descontinuada', 'em_construcao')),
  percentual_pronto integer NOT NULL DEFAULT 0 CHECK (percentual_pronto BETWEEN 0 AND 100),
  prioridade text NOT NULL DEFAULT 'media'
    CHECK (prioridade IN ('critica', 'alta', 'media', 'baixa')),
  cobre_planos text[] DEFAULT ARRAY[]::text[],
  prs_relacionados text[] DEFAULT ARRAY[]::text[],
  ondas_relacionadas text[] DEFAULT ARRAY[]::text[],
  marcos_roadmap text[] DEFAULT ARRAY[]::text[],
  pilar_inviolavel integer CHECK (pilar_inviolavel IN (1, 2, 3)),
  regras_estrela_polar integer[] DEFAULT ARRAY[]::integer[],
  observacao text,
  criado_em timestamptz DEFAULT NOW(),
  atualizado_em timestamptz DEFAULT NOW()
);

COMMENT ON TABLE public.feature_catalog IS
'Manual Vivo V1: catalogo hierarquico (Plano -> Modulo -> Feature). Atualizado conforme PRs. Criado em 10/05/2026.';

CREATE INDEX IF NOT EXISTS idx_feature_module ON public.feature_catalog(module_id, area);
CREATE INDEX IF NOT EXISTS idx_feature_status ON public.feature_catalog(status, prioridade);
CREATE INDEX IF NOT EXISTS idx_feature_planos ON public.feature_catalog USING GIN(cobre_planos);

ALTER TABLE public.feature_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_can_read_features" ON public.feature_catalog;
CREATE POLICY "auth_can_read_features" ON public.feature_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_role_writes_features" ON public.feature_catalog;
CREATE POLICY "service_role_writes_features" ON public.feature_catalog
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.fn_features_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_features_atualizado_em ON public.feature_catalog;
CREATE TRIGGER trg_features_atualizado_em
BEFORE UPDATE ON public.feature_catalog
FOR EACH ROW EXECUTE FUNCTION public.fn_features_atualizado_em();

-- ETAPA 2: View v_modulo_status_consolidado
DROP VIEW IF EXISTS public.v_modulo_status_consolidado CASCADE;
CREATE VIEW public.v_modulo_status_consolidado AS
SELECT
  m.id AS module_id,
  m.nome AS modulo_nome,
  m.layer,
  m.grupo,
  COUNT(f.id) AS total_features,
  COUNT(*) FILTER (WHERE f.status = 'pronto') AS prontas,
  COUNT(*) FILTER (WHERE f.status = 'parcial') AS parciais,
  COUNT(*) FILTER (WHERE f.status = 'previsto') AS previstas,
  COUNT(*) FILTER (WHERE f.status = 'em_construcao') AS em_construcao,
  ROUND(AVG(f.percentual_pronto)::numeric, 0) AS percentual_medio,
  CASE
    WHEN COUNT(f.id) = 0 THEN 'sem_features_catalogadas'
    WHEN COUNT(*) FILTER (WHERE f.status = 'pronto') = COUNT(f.id) THEN 'modulo_pronto'
    WHEN COUNT(*) FILTER (WHERE f.status IN ('pronto', 'parcial')) >= COUNT(f.id) * 0.7 THEN 'modulo_quase_pronto'
    WHEN COUNT(*) FILTER (WHERE f.status = 'pronto') >= 1 THEN 'modulo_em_construcao'
    ELSE 'modulo_planejado'
  END AS status_modulo
FROM module_catalog m
LEFT JOIN feature_catalog f ON f.module_id = m.id
WHERE m.ativo = true AND m.legacy = false
GROUP BY m.id, m.nome, m.layer, m.grupo
ORDER BY m.layer, m.nome;

-- ETAPA 3: View v_plano_features_completas (CORRIGIDA)
DROP VIEW IF EXISTS public.v_plano_features_completas CASCADE;
CREATE VIEW public.v_plano_features_completas AS
SELECT
  p.id AS plano_id,
  p.nome AS plano_nome,
  p.tier_internal AS tier,
  p.vertical,
  p.plan_group,
  COUNT(DISTINCT pm.module_id) AS modulos_no_plano,
  COUNT(DISTINCT f.id) AS features_total,
  COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'pronto') AS features_prontas,
  COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'parcial') AS features_parciais,
  COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'previsto') AS features_previstas,
  CASE
    WHEN COUNT(DISTINCT f.id) = 0 THEN 0
    ELSE ROUND((COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'pronto')::numeric / COUNT(DISTINCT f.id)::numeric * 100), 0)
  END AS percentual_pronto_para_vender
FROM plan_catalog p
LEFT JOIN plan_modules pm ON pm.plan_id = p.id
LEFT JOIN feature_catalog f ON f.module_id = pm.module_id
WHERE p.ativo = true
GROUP BY p.id, p.nome, p.tier_internal, p.vertical, p.plan_group
ORDER BY p.id;

-- ETAPA 4: View v_features_pendentes_caminho_critico
DROP VIEW IF EXISTS public.v_features_pendentes_caminho_critico CASCADE;
CREATE VIEW public.v_features_pendentes_caminho_critico AS
SELECT
  f.id AS feature_id,
  f.titulo,
  m.nome AS modulo,
  f.area,
  f.status,
  f.percentual_pronto,
  f.prioridade,
  f.marcos_roadmap,
  f.observacao
FROM feature_catalog f
JOIN module_catalog m ON m.id = f.module_id
WHERE f.status IN ('previsto', 'parcial', 'em_construcao')
  AND f.prioridade IN ('critica', 'alta')
ORDER BY
  CASE f.prioridade WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 ELSE 3 END,
  CASE f.status WHEN 'em_construcao' THEN 1 WHEN 'parcial' THEN 2 WHEN 'previsto' THEN 3 END,
  m.nome,
  f.titulo;

-- ETAPA 5: View v_catalogo_executivo
DROP VIEW IF EXISTS public.v_catalogo_executivo CASCADE;
CREATE VIEW public.v_catalogo_executivo AS
SELECT
  m.layer,
  m.grupo,
  m.id AS module_id,
  m.nome AS modulo_nome,
  m.descricao AS modulo_descricao,
  f.id AS feature_id,
  f.titulo AS feature_titulo,
  f.descricao_executiva,
  f.status,
  f.percentual_pronto,
  f.prioridade,
  f.cobre_planos,
  f.area,
  CASE f.status
    WHEN 'pronto' THEN 'pronto'
    WHEN 'parcial' THEN 'parcial'
    WHEN 'em_construcao' THEN 'em_construcao'
    WHEN 'previsto' THEN 'previsto'
    WHEN 'descontinuada' THEN 'descontinuada'
  END AS status_label
FROM module_catalog m
LEFT JOIN feature_catalog f ON f.module_id = m.id
WHERE m.ativo = true AND m.legacy = false
ORDER BY m.layer, m.grupo, m.nome, f.prioridade NULLS LAST, f.titulo NULLS LAST;
