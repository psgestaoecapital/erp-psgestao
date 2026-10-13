-- PR-2 CAMADA 1 PLAYWRIGHT (CEO 26/05/2026 · arquitetura GitHub Actions)
-- Aplicado via MCP apply_migration · rastreio histórico.
--
-- Auditor Playwright via GitHub Actions enumera DOM real 4x/dia (06h/12h/18h/00h UTC).
-- Resolve foundationalmente bug "botão aponta pra 404" descoberto via print CEO 26/05.
--
-- Workflow: .github/workflows/auditor-playwright.yml
-- Script:   scripts/auditor-playwright.ts (chromium headless · HEAD em links DOM)
-- Rotas:    scripts/auditor-rotas.json (20 rotas críticas)
--
-- Resultados persistidos em gold_dom_enumerations.
-- Alertas críticos em erp_truth_alerts quando links_404 > 0.

CREATE TABLE IF NOT EXISTS gold_dom_enumerations (
  id uuid primary key default gen_random_uuid(),
  rota text not null,
  executado_em timestamp with time zone default now(),
  links_total int default 0,
  links_200 int default 0,
  links_404 int default 0,
  enumeracao_json jsonb,
  pr_numero int,
  fonte text default 'github_actions',
  created_at timestamp with time zone default now()
);

CREATE INDEX IF NOT EXISTS idx_gold_dom_rota_executado
  ON gold_dom_enumerations(rota, executado_em DESC);

CREATE INDEX IF NOT EXISTS idx_gold_dom_links_404
  ON gold_dom_enumerations(links_404)
  WHERE links_404 > 0;

DROP FUNCTION IF EXISTS fn_camada1_playwright_enumerar_dom(text);

CREATE OR REPLACE FUNCTION fn_camada1_consultar_enumeracao(p_rota text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'rota', rota,
    'executado_em', executado_em,
    'links_total', links_total,
    'links_200', links_200,
    'links_404', links_404,
    'detalhes', enumeracao_json -> 'links_encontrados_dom',
    'fonte', fonte
  )
  FROM gold_dom_enumerations
  WHERE rota = p_rota
  ORDER BY executado_em DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION fn_camada1_consultar_enumeracao(text) TO service_role, authenticated;
GRANT SELECT, INSERT ON gold_dom_enumerations TO service_role;
