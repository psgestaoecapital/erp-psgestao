-- ============================================================
-- Lei 12.741/2012 (Transparência Fiscal) · template do "valor aproximado dos tributos"
-- ============================================================
-- Achado (chamado #70): as 98 NFS-e do sistema saíram SEM o valor aproximado dos tributos
-- exigido pela Lei 12.741/2012 — provado na fonte (DANFSe com o bloco "Totais Aproximados dos
-- Tributos" vazio). As 5 empresas são Simples Nacional, e para o SN a lei aceita declarar um
-- ÚNICO percentual aproximado (já configurado em percentual_total_tributos_sn). O valor vai nas
-- INFORMAÇÕES COMPLEMENTARES da nota (Focus: informacoes_complementares no nacional /v2/nfsen,
-- outras_informacoes no municipal /v2/nfse) — não em campo estruturado por esfera.
--
-- A redação fica como PARÂMETRO por empresa (ao lado do percentual), não chumbada no código: o
-- contador pode ajustar a frase por UPDATE, sem PR. Placeholders {valor} e {percentual} são
-- substituídos na emissão (valor = percentual × valor do serviço; mostra R$ e %).
ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS lei12741_observacao_template text
    DEFAULT 'Valor aproximado dos tributos: R$ {valor} ({percentual}%) — Fonte: Simples Nacional, Lei 12.741/2012';

COMMENT ON COLUMN public.erp_fiscal_provider_config.lei12741_observacao_template IS
  'Lei 12.741/2012 · texto do valor aproximado dos tributos nas informações complementares da NFS-e. Placeholders {valor} e {percentual} substituídos na emissão. Só compõe quando percentual_total_tributos_sn está preenchido (Simples Nacional).';
