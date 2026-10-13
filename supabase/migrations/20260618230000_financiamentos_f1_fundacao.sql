-- ============================================================
-- F1 · Fundacao de dados: Financiamentos & Consorcios
-- ============================================================

-- 1) financiamentos · campos ricos (3.1/3.2)
ALTER TABLE public.financiamentos
  ADD COLUMN IF NOT EXISTS tipo_operacao text DEFAULT 'financiamento',
  ADD COLUMN IF NOT EXISTS instituicao text,
  ADD COLUMN IF NOT EXISTS agencia text,
  ADD COLUMN IF NOT EXISTS conta text,
  ADD COLUMN IF NOT EXISTS linha_produto text,
  ADD COLUMN IF NOT EXISTS finalidade text,
  ADD COLUMN IF NOT EXISTS iof numeric,
  ADD COLUMN IF NOT EXISTS tarifas_abertura numeric,
  ADD COLUMN IF NOT EXISTS cet numeric,
  ADD COLUMN IF NOT EXISTS valor_amortizado numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS juros_pagos      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parcelas_pagas   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS indexador text,
  ADD COLUMN IF NOT EXISTS percentual_indexador numeric,
  ADD COLUMN IF NOT EXISTS spread numeric,
  ADD COLUMN IF NOT EXISTS periodicidade text DEFAULT 'mensal',
  ADD COLUMN IF NOT EXISTS dia_vencimento integer,
  ADD COLUMN IF NOT EXISTS data_primeira_parcela date,
  ADD COLUMN IF NOT EXISTS sistema_amortizacao text,
  ADD COLUMN IF NOT EXISTS carencia_meses integer,
  ADD COLUMN IF NOT EXISTS carencia_fim date,
  ADD COLUMN IF NOT EXISTS carencia_tipo text,
  ADD COLUMN IF NOT EXISTS data_liberacao date,
  ADD COLUMN IF NOT EXISTS administradora text,
  ADD COLUMN IF NOT EXISTS grupo text,
  ADD COLUMN IF NOT EXISTS cota text,
  ADD COLUMN IF NOT EXISTS valor_carta_credito numeric,
  ADD COLUMN IF NOT EXISTS taxa_administracao numeric,
  ADD COLUMN IF NOT EXISTS fundo_reserva numeric,
  ADD COLUMN IF NOT EXISTS seguro numeric,
  ADD COLUMN IF NOT EXISTS fundo_comum numeric,
  ADD COLUMN IF NOT EXISTS prazo_grupo integer,
  ADD COLUMN IF NOT EXISTS contemplado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_contemplacao date,
  ADD COLUMN IF NOT EXISTS forma_contemplacao text,
  ADD COLUMN IF NOT EXISTS valor_lance numeric;

-- 2) financiamento_parcelas · campos do cronograma rico (3.3)
ALTER TABLE public.financiamento_parcelas
  ADD COLUMN IF NOT EXISTS taxa_adm   numeric,
  ADD COLUMN IF NOT EXISTS seguro     numeric,
  ADD COLUMN IF NOT EXISTS valor_pago numeric,
  ADD COLUMN IF NOT EXISTS pagar_ref  text;

-- 3) Garantias · cadastro reutilizavel (modelo B)
CREATE TABLE IF NOT EXISTS public.financiamento_garantias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  tipo          text NOT NULL DEFAULT 'sem_garantia',
  descricao     text NOT NULL DEFAULT '',
  identificacao text,
  valor_avaliado numeric,
  observacao    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.financiamento_garantias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fg_all ON public.financiamento_garantias;
CREATE POLICY fg_all ON public.financiamento_garantias
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK   (company_id IN (SELECT get_user_company_ids()) OR is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financiamento_garantias TO authenticated;
GRANT ALL ON public.financiamento_garantias TO service_role;

-- 4) Alocacao garantia <-> contrato (N:N)
CREATE TABLE IF NOT EXISTS public.financiamento_garantia_vinculo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  garantia_id      uuid NOT NULL REFERENCES public.financiamento_garantias(id) ON DELETE CASCADE,
  financiamento_id uuid NOT NULL REFERENCES public.financiamentos(id) ON DELETE CASCADE,
  valor_alocado    numeric,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_garantia_financiamento UNIQUE (garantia_id, financiamento_id)
);
CREATE INDEX IF NOT EXISTS idx_fgv_financiamento ON public.financiamento_garantia_vinculo(financiamento_id);
CREATE INDEX IF NOT EXISTS idx_fgv_garantia      ON public.financiamento_garantia_vinculo(garantia_id);
ALTER TABLE public.financiamento_garantia_vinculo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fgv_all ON public.financiamento_garantia_vinculo;
CREATE POLICY fgv_all ON public.financiamento_garantia_vinculo
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK   (company_id IN (SELECT get_user_company_ids()) OR is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financiamento_garantia_vinculo TO authenticated;
GRANT ALL ON public.financiamento_garantia_vinculo TO service_role;

COMMENT ON TABLE public.financiamento_garantias IS
'financiamentos-f1 · cadastro de garantia reutilizavel (modelo B · 1 garantia pode lastrear varios contratos).';
COMMENT ON TABLE public.financiamento_garantia_vinculo IS
'financiamentos-f1 · vinculo N:N entre garantia e contrato com valor alocado.';
