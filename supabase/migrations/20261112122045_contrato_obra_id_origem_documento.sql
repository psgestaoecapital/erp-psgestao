-- Blueprint Hub V8 §15 ④/⑤-bis e §16 H1/H2 — fundação do contrato ligado à obra.
-- PR (1a) da diretriz (msg 0d66f96c): apenas as DUAS COLUNAS ADITIVAS que faltam em erp_contratos.
-- A trava de divergência de valor (tolerância por empresa em projetos_modulo_config), o aceite explícito e
-- a criação da obra com itens na aprovação vêm em PRs seguintes desta mesma ordem — esta só prepara o esquema.
--
-- RD-38 (provado no dado ANTES desta migration): erp_contratos NÃO tinha obra_id nem origem_documento
--   (information_schema.columns: 0 linhas para ambas em public.erp_contratos em 2026-11-10).
-- RD-52: migration é ARQUIVO+PR; aplicada só pelo deploy-migrations no merge. Nunca via MCP.
-- Aditiva e idempotente: só ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. Sem UPDATE/DELETE de dado de cliente.
-- erp_contratos já tem RLS por company_id ligada (relrowsecurity = true); colunas novas herdam a política da tabela,
-- então não há policy nova nem grant a mexer. obra_id e origem_documento ficam NULL nos contratos já existentes
-- (contratos recorrentes da GE seguem iguais); só os contratos de obra do Hub passam a preenchê-los.

-- (1) Vínculo opcional com a obra do Hub. ON DELETE SET NULL: apagar a obra não apaga o contrato, só desfaz o vínculo.
ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS obra_id uuid REFERENCES public.projetos_obras(id) ON DELETE SET NULL;

-- (2) Origem do documento do contrato: modelo próprio da empresa ou documento da contratante.
ALTER TABLE public.erp_contratos
  ADD COLUMN IF NOT EXISTS origem_documento text
    CHECK (origem_documento IS NULL OR origem_documento IN ('modelo_proprio', 'da_contratante'));

-- Índice para buscar os contratos de uma obra (consultas "aba Contrato" da obra, PRs seguintes). Parcial: só os vinculados.
CREATE INDEX IF NOT EXISTS idx_erp_contratos_obra_id
  ON public.erp_contratos (obra_id) WHERE obra_id IS NOT NULL;

COMMENT ON COLUMN public.erp_contratos.obra_id IS
  'Obra do Hub (projetos_obras) a que este contrato pertence. NULL nos contratos recorrentes da GE. Blueprint Hub V8 §15/§16.';
COMMENT ON COLUMN public.erp_contratos.origem_documento IS
  'Origem do documento do contrato de obra: modelo_proprio (modelo da empresa) ou da_contratante (documento recebido). NULL quando não se aplica.';
