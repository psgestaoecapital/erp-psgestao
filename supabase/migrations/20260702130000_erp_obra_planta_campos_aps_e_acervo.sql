-- Takeoff DWG F1+F2a — campos APS + trilha do engenheiro + acervo permanente.
-- aps_urn/status/traduzido_em/diagnostico: rastreio do processamento no APS.
-- analisado_em/por: ficha da analise paga (data-hora + engenheiro user).
-- arquivo_dwg_path: caminho no bucket persistente 'projetos-plantas'.
-- Idempotente. Aplicada via MCP em 2026-07-02.

ALTER TABLE public.erp_obra_planta
  ADD COLUMN IF NOT EXISTS aps_urn text,
  ADD COLUMN IF NOT EXISTS aps_status text,
  ADD COLUMN IF NOT EXISTS aps_traduzido_em timestamptz,
  ADD COLUMN IF NOT EXISTS aps_diagnostico jsonb,
  ADD COLUMN IF NOT EXISTS analisado_em timestamptz,
  ADD COLUMN IF NOT EXISTS analisado_por uuid,
  ADD COLUMN IF NOT EXISTS arquivo_dwg_path text;

CREATE INDEX IF NOT EXISTS idx_erp_obra_planta_company_status
  ON public.erp_obra_planta (company_id, aps_status);
