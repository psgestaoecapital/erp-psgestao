-- Motor de Custo Pecuário Genérico — Fase 1 (DDL · 3 tabelas).
-- Princípio: o motor NÃO conhece "cria"/"engorda". Acumula custo por lote e divide
-- pela unidade de produção da fase. Rateio do comum por UA (decisão A do CEO);
-- custo acumulado acompanha o animal (decisão B). RD-41 · RD-35 · RD-38.
-- Tabelas novas e vazias — sem backup necessário.

-- 1.1 Lançamentos de custo (direto no lote, comum rateável, ou extra fora do indicador)
CREATE TABLE IF NOT EXISTS public.erp_pec_custo_lancamento (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  propriedade_id    uuid,
  lote_id           uuid,                         -- NULL = custo comum (rateável por UA)
  tipo_apropriacao  text NOT NULL CHECK (tipo_apropriacao IN ('direto','comum','extra')),
  categoria         text CHECK (categoria IN ('nutricao','sanidade','reproducao','mao_obra',
                                              'pastagem','arrendamento','maquinas','administrativo','outro')),
  descricao         text,
  valor             numeric(14,2) NOT NULL CHECK (valor >= 0),
  data_competencia  date NOT NULL,
  data_pagamento    date,
  meses_diluicao    int NOT NULL DEFAULT 1 CHECK (meses_diluicao >= 1),
  ciclo_ref         text,                          -- ex.: 'estacao_monta_2026' (apropria ao ciclo, não ao calendário)
  origem            text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','erp_pagar','importacao')),
  origem_ref_id     text,                          -- id da origem (idempotência)
  observacao        text,
  criado_por        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_custo_lanc_comp_comp ON public.erp_pec_custo_lancamento (company_id, data_competencia);
CREATE INDEX IF NOT EXISTS idx_pec_custo_lanc_comp_lote ON public.erp_pec_custo_lancamento (company_id, lote_id);
-- idempotência de importação: 1 origem_ref_id por (empresa, origem)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_custo_lanc_origem
  ON public.erp_pec_custo_lancamento (company_id, origem, origem_ref_id)
  WHERE origem_ref_id IS NOT NULL;

-- 1.2 Eventos de produção (desmame, ganho, venda, transferência, morte, nascimento, leite)
CREATE TABLE IF NOT EXISTS public.erp_pec_producao_evento (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  lote_id      uuid,
  animal_id    uuid,
  tipo         text NOT NULL CHECK (tipo IN ('desmame','ganho_peso','venda','transferencia_fase','morte','nascimento','leite')),
  data         date NOT NULL,
  quantidade   numeric(14,3),
  unidade      text NOT NULL CHECK (unidade IN ('cabeca','kg','arroba','litro')),
  peso_kg      numeric(14,3),
  valor        numeric(14,2),
  observacao   text,
  criado_por   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_prod_evt_comp_lote_data ON public.erp_pec_producao_evento (company_id, lote_id, data);

-- 1.3 Custo acumulado POR ANIMAL (segue o animal entre fases — decisão B)
CREATE TABLE IF NOT EXISTS public.erp_pec_custo_animal (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  animal_id             uuid,
  lote_id               uuid,
  fase                  text,
  tipo                  text NOT NULL CHECK (tipo IN ('aquisicao','apropriado','transferencia_entrada','transferencia_saida')),
  valor                 numeric(14,2) NOT NULL DEFAULT 0,
  data_ref              date,
  origem_lancamento_id  uuid,
  criado_por            uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pec_custo_animal_comp_animal ON public.erp_pec_custo_animal (company_id, animal_id);
-- idempotência do rateio: 1 apropriação por (lançamento, animal)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pec_custo_animal_lanc_animal
  ON public.erp_pec_custo_animal (origem_lancamento_id, animal_id)
  WHERE origem_lancamento_id IS NOT NULL AND tipo = 'apropriado';

-- ── RLS (tenant): company_id IN (get_user_company_ids()) OR is_admin() ──────────
ALTER TABLE public.erp_pec_custo_lancamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pec_producao_evento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pec_custo_animal      ENABLE ROW LEVEL SECURITY;

CREATE POLICY pec_custo_lanc_tenant ON public.erp_pec_custo_lancamento
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY pec_prod_evt_tenant ON public.erp_pec_producao_evento
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE POLICY pec_custo_animal_tenant ON public.erp_pec_custo_animal
  FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
