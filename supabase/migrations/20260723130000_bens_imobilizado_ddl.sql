-- Cadastro de Bens / Imobilizado / Depreciação (GE genérico). RD-41/26/55/51.
CREATE TABLE IF NOT EXISTS public.erp_bem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  codigo text NULL,
  descricao text NOT NULL,
  natureza text NOT NULL CHECK (natureza IN (
    'terreno','edificacao','benfeitoria','maquina','equipamento','veiculo',
    'movel_utensilio','computador','software','instalacao',
    'semovente','cultura_permanente','participacao','outro')),
  conta_id uuid NULL REFERENCES public.erp_plano_contas(id),
  data_aquisicao date NOT NULL,
  valor_aquisicao numeric(14,2) NOT NULL CHECK (valor_aquisicao >= 0),
  fornecedor_nome text NULL, documento text NULL,
  origem_lancamento_tabela text NULL, origem_lancamento_id uuid NULL,
  deprecia boolean NOT NULL DEFAULT true,
  vida_util_meses int NULL CHECK (vida_util_meses > 0),
  valor_residual numeric(14,2) NOT NULL DEFAULT 0,
  metodo_depreciacao text NOT NULL DEFAULT 'linear'
    CHECK (metodo_depreciacao IN ('linear','saldo_decrescente','unidades_produzidas')),
  data_inicio_depreciacao date NULL,
  business_line_id uuid NULL REFERENCES public.business_lines(id),
  centro_custo text NULL,
  propriedade_area_id uuid NULL REFERENCES public.erp_propriedade_area(id),
  planta_id uuid NULL,
  status text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo','baixado','vendido','sinistrado','em_construcao')),
  observacao text NULL, criado_por uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bem ON public.erp_bem (company_id, status, natureza);
ALTER TABLE public.erp_bem ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_bem ON public.erp_bem FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE TABLE IF NOT EXISTS public.erp_bem_depreciacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bem_id uuid NOT NULL REFERENCES public.erp_bem(id) ON DELETE CASCADE,
  competencia date NOT NULL, valor numeric(14,2) NOT NULL, base_calculo numeric(14,2) NOT NULL,
  acumulado numeric(14,2) NOT NULL, valor_contabil numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (bem_id, competencia)
);
ALTER TABLE public.erp_bem_depreciacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_bem_dep ON public.erp_bem_depreciacao FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE TABLE IF NOT EXISTS public.erp_bem_movimentacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bem_id uuid NOT NULL REFERENCES public.erp_bem(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('aquisicao','melhoria','baixa','venda','sinistro','reavaliacao','transferencia')),
  data date NOT NULL, valor numeric(14,2) NOT NULL, valor_contabil_na_data numeric(14,2) NULL,
  resultado numeric(14,2) NULL, justificativa text NULL, documento text NULL, criado_por uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_bem_movimentacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_bem_mov ON public.erp_bem_movimentacao FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE TABLE IF NOT EXISTS public.erp_bem_natureza_padrao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL, natureza text NOT NULL, vida_util_meses int NULL,
  deprecia boolean NOT NULL DEFAULT true, conta_sugerida_codigo text NULL,
  UNIQUE (company_id, natureza)
);
ALTER TABLE public.erp_bem_natureza_padrao ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_bem_nat ON public.erp_bem_natureza_padrao FOR ALL
  USING (company_id IS NULL OR company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- Seed global sugerido (cadastrável/sobrescrevível). Guarda idempotência (NULL company_id não conflita).
INSERT INTO public.erp_bem_natureza_padrao (company_id, natureza, vida_util_meses, deprecia, conta_sugerida_codigo)
SELECT NULL, v.natureza, v.vida, v.dep, v.conta FROM (VALUES
  ('terreno',NULL,false,'10.1'),('edificacao',300,true,'10.2'),('benfeitoria',300,true,'4.9.06'),
  ('maquina',120,true,'10.3'),('equipamento',120,true,'4.9.01'),('veiculo',60,true,'4.9.02'),
  ('movel_utensilio',120,true,NULL),('computador',60,true,NULL),('software',60,true,NULL),
  ('instalacao',120,true,NULL),('semovente',60,true,NULL),('cultura_permanente',NULL,true,NULL),
  ('participacao',NULL,false,NULL),('outro',NULL,true,NULL)
) AS v(natureza,vida,dep,conta)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_bem_natureza_padrao p WHERE p.company_id IS NULL AND p.natureza=v.natureza);
