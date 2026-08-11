-- ============================================================
-- Hub de Projetos · Sprint S0 — Fundação da Precificação (Pilar 1 · RD-53/54/55).
-- Premissas de preço por empresa/linha (as 12 premissas da planilha "PREMISSAS FINANCEIRAS").
-- Nada hardcoded por ramo — tudo cadastro por empresa/linha. custo_fixo_mensal/m² NÃO ficam aqui:
-- são derivados do rateio (S3 = custo fixo da linha ÷ produção meta/realizado).
-- creditos_pct nasce da config, coerente com companies.regime_tributario (real/presumido creditam;
-- simples ~não).
-- ============================================================

-- A.1 — Premissas de precificação por empresa/linha
CREATE TABLE IF NOT EXISTS public.erp_precificacao_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  business_line_id uuid,                          -- NULL = vale p/ a empresa toda
  vigencia_inicio date NOT NULL DEFAULT current_date,
  -- mão de obra / produtividade
  custo_folha_hora     numeric,                   -- R$/hora do funcionário
  tempo_m2_min         numeric,                   -- min por m² (produtividade)
  imposto_mo_pct       numeric,                   -- encargos sobre MO
  margem_mo_pct        numeric,                   -- markup MO
  -- material / tributário
  margem_material_pct  numeric,                   -- markup material (default; ajustável por obra)
  icms_pct             numeric,
  pis_cofins_pct       numeric,
  creditos_pct         numeric,                   -- créditos tributários (coerente com o regime)
  -- comercial / volume
  comissao_pct         numeric,                   -- comissão de venda default
  meta_producao_m2     numeric,                   -- meta mensal (base do custo fixo teórico)
  base_custo_fixo      text NOT NULL DEFAULT 'meta' CHECK (base_custo_fixo IN ('meta','realizado')),
  ativo boolean NOT NULL DEFAULT true,
  observacao text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, business_line_id, vigencia_inicio)
);
ALTER TABLE public.erp_precificacao_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_precif_config_sel ON public.erp_precificacao_config;
CREATE POLICY erp_precif_config_sel ON public.erp_precificacao_config FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
DROP POLICY IF EXISTS erp_precif_config_wr ON public.erp_precificacao_config;
CREATE POLICY erp_precif_config_wr ON public.erp_precificacao_config FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- B — Seed do perfil GESSO (Tryo Gessos 918c3ea4 · regime real) — CONFIRMADO (empresa toda).
-- Valores da planilha PREMISSAS FINANCEIRAS. Idempotente (ON CONFLICT no unique da vigência).
INSERT INTO public.erp_precificacao_config
 (company_id, business_line_id, custo_folha_hora, tempo_m2_min, imposto_mo_pct, margem_mo_pct,
  margem_material_pct, icms_pct, pis_cofins_pct, creditos_pct, comissao_pct, meta_producao_m2, base_custo_fixo, observacao)
VALUES
 ('918c3ea4-770d-4a10-9200-f9c21f92a1f6', NULL, 25, 80, 10, 20, 10, 17, 9.3, 21.3, 5, 8500, 'meta',
  'Seed premissas Gesso (planilha PREMISSAS FINANCEIRAS)')
ON CONFLICT (company_id, business_line_id, vigencia_inicio) DO NOTHING;

-- B — Seed do perfil PISOS (Tryo Acabamentos 50b1da9b · regime simples) — CONFIRMADO pelo CEO:
-- linha 'Piso' (business_line d3815fb4). Regime simples → créditos 4,0 (não credita 21,3 como o real).
INSERT INTO public.erp_precificacao_config
 (company_id, business_line_id, custo_folha_hora, tempo_m2_min, imposto_mo_pct, margem_mo_pct,
  margem_material_pct, icms_pct, pis_cofins_pct, creditos_pct, comissao_pct, meta_producao_m2, base_custo_fixo, observacao)
VALUES
 ('50b1da9b-7367-4489-8b50-e62dd6efc760', 'd3815fb4-1d45-409e-bd7a-ede0704ee289', 25, 80, 10, 20, 10, 17, 9.3, 4.0, 0, 5460, 'meta',
  'Seed premissas Pisos (linha Piso · Tryo Acabamentos · regime simples)')
ON CONFLICT (company_id, business_line_id, vigencia_inicio) DO NOTHING;
