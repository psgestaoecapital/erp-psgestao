-- =============================================================
-- FEAT-CADASTRO-SERVICOS-v1 · PR-1 (tabela + RLS + indices + helper)
-- =============================================================
-- Multi-tenant · serve TODAS as empresas · espelha pattern de erp_produtos
-- na intencao (catalogo reutilizavel) e o pattern RLS de erp_inventarios /
-- erp_estoque_locais na execucao (RLS habilitado · policy company_id).
--
-- Campos cobrem as 4 abas do OMIE:
--   * Servico: descricao + classificacao fiscal (NBS, codigo municipio,
--     LC116, CNAE, tipo tributacao, %ISS, retido, valor, %desconto)
--   * Impostos Federais: PIS/COFINS/IR/CSLL/INSS (% + retido)
--   * Produtos Utilizados: BOM · NAO modelado nesta PR (Regra #12)
--   * Reforma Tributaria: campos armazenados · UI desabilita pra Simples
--     Nacional (regime vem de erp_fiscal_provider_config.regime_tributario)
--
-- Helper fn_next_servico_codigo(company_id) -> 'SRV00001' sequencial por
-- empresa (espelha next_inventario_numero).
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.erp_servicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  codigo varchar,
  descricao_resumida varchar NOT NULL,
  descricao_detalhada text,
  categoria varchar,
  -- Classificacao fiscal (aba Servico)
  codigo_nbs varchar,
  codigo_servico_municipio varchar,
  codigo_lc116 varchar,
  cnae varchar,
  cnae_secundario varchar,
  tipo_tributacao varchar,
  aliquota_iss numeric DEFAULT 0,
  iss_retido boolean DEFAULT false,
  valor_unitario numeric DEFAULT 0,
  pct_desconto numeric DEFAULT 0,
  -- Impostos e Contribuicoes Federais
  aliquota_pis numeric DEFAULT 0,    retem_pis boolean DEFAULT false,
  aliquota_cofins numeric DEFAULT 0, retem_cofins boolean DEFAULT false,
  aliquota_ir numeric DEFAULT 0,     retem_ir boolean DEFAULT false,
  aliquota_csll numeric DEFAULT 0,   retem_csll boolean DEFAULT false,
  aliquota_inss numeric DEFAULT 0,   retem_inss boolean DEFAULT false,
  -- Reforma Tributaria
  rt_cst varchar,
  rt_classificacao_tributaria varchar,
  rt_indicador_operacao varchar,
  rt_aliquota_ibs_municipal numeric DEFAULT 0,
  rt_aliquota_ibs_estadual numeric DEFAULT 0,
  rt_aliquota_cbs numeric DEFAULT 0,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_servicos_company        ON public.erp_servicos (company_id);
CREATE INDEX IF NOT EXISTS idx_erp_servicos_descricao_trgm ON public.erp_servicos USING gin (descricao_resumida gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_erp_servicos_codigo_trgm    ON public.erp_servicos USING gin (codigo gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_servicos_company_codigo
  ON public.erp_servicos (company_id, codigo) WHERE codigo IS NOT NULL;

DROP TRIGGER IF EXISTS trg_erp_servicos_updated ON public.erp_servicos;
CREATE TRIGGER trg_erp_servicos_updated BEFORE UPDATE ON public.erp_servicos
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp_col();

ALTER TABLE public.erp_servicos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_servicos_all ON public.erp_servicos;
CREATE POLICY erp_servicos_all ON public.erp_servicos
  FOR ALL
  USING (
    (company_id IN (SELECT user_companies.company_id FROM user_companies WHERE user_companies.user_id = auth.uid()))
    OR (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = ANY (ARRAY['adm'::text,'acesso_total'::text,'adm_investimentos'::text])))
  );

CREATE OR REPLACE FUNCTION public.fn_next_servico_codigo(p_company_id uuid)
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
  v_max int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(codigo, '^SRV', ''))::int), 0)
    INTO v_max
    FROM public.erp_servicos
   WHERE company_id = p_company_id
     AND codigo ~ '^SRV[0-9]+$';
  RETURN 'SRV' || lpad((v_max + 1)::text, 5, '0');
END; $$;

GRANT EXECUTE ON FUNCTION public.fn_next_servico_codigo(uuid) TO authenticated;
