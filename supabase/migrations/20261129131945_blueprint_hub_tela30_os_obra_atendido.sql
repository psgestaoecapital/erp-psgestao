-- Reconcilia baseline do Hub §30 (HB0 · fotografia 09/10): a Ordem de Serviço do Hub
-- NÃO usa mais campos de oficina (placa, veículo, mecânico) — virou OS de obra.
--
-- RD-38 (provado no código vivo em main):
--   src/app/dashboard/projetos/obras/os/page.tsx (HB0 item 6):
--     - título <h1>Ordens de serviço de obra</h1>
--     - campos: Obra, Etapa, Serviço, Equipe, Responsável, O que fazer, Para quando, Prioridade
--     - SEM placa/veículo/mecânico (esses seguem só na OS da oficina em /dashboard/os, intocada)
--   Alcançável pelo Cockpit da obra:
--     src/app/dashboard/projetos/obras/[id]/cockpit/page.tsx (data-testid="link-os-obra")
--     → /dashboard/projetos/obras/os?obra=<id>&area=hub
--
-- Aditiva e idempotente: só carimba o status_baseline desta única linha (id fixo), sem
-- tocar em dado de cliente nem em estrutura.

UPDATE public.blueprint_tela_requisito
SET status_baseline  = 'atendido',
    evidencia_baseline = 'PR desenvolvedor_4_g · OS de obra do Hub em /dashboard/projetos/obras/os (título "Ordens de serviço de obra"; campos obra/etapa/serviço/equipe; sem placa/veículo/mecânico), alcançável pelo Cockpit da obra (link-os-obra). A OS da oficina (/dashboard/os) segue separada e intocada.'
WHERE id = '3aaca49c-ac96-4646-8d78-4105d1ce81fc'
  AND vertical    = 'hub_projetos'
  AND tela_num    = 30
  AND status_baseline <> 'atendido';
