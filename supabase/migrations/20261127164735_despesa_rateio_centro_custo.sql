-- Rateio do lançamento a pagar entre N centros de custo (gap2 PDCA auditor_pdca_2 22/11, blueprint 206 · GE)
-- Tela: /dashboard/financeiro/nova-despesa · componente NovaDespesaForm/RateioDespesa.
-- ADITIVA: tabela-filha nova, nenhuma coluna/dado existente alterado. Um lançamento que serve mais de uma obra
-- (princípio 4 do caixa por obra do Hub) passa a dividir o valor entre vários centros de custo por percentual.
-- O percentual é o canônico; o valor em R$ é derivado do valor do título × percentual na leitura (sem arredondamento
-- gravado que possa divergir). RLS por empresa (idioma erp_pagar: get_user_company_ids() OR is_admin()); REVOKE anon.

CREATE TABLE IF NOT EXISTS public.erp_pagar_rateio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pagar_id        uuid        NOT NULL REFERENCES public.erp_pagar(id) ON DELETE CASCADE,
  centro_custo_id uuid        REFERENCES public.erp_centros_custo(id) ON DELETE RESTRICT,
  categoria       varchar,
  percentual      numeric(7,4) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  valor           numeric      CHECK (valor IS NULL OR valor >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- cada linha precisa de ao menos um destino (centro de custo ou categoria)
  CONSTRAINT erp_pagar_rateio_destino_chk CHECK (centro_custo_id IS NOT NULL OR categoria IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_erp_pagar_rateio_pagar   ON public.erp_pagar_rateio(pagar_id);
CREATE INDEX IF NOT EXISTS idx_erp_pagar_rateio_company ON public.erp_pagar_rateio(company_id);
CREATE INDEX IF NOT EXISTS idx_erp_pagar_rateio_cc      ON public.erp_pagar_rateio(centro_custo_id);

COMMENT ON TABLE public.erp_pagar_rateio IS 'Rateio de um título a pagar entre N centros de custo/categorias (por percentual). Valor derivado = erp_pagar.valor × percentual/100.';

ALTER TABLE public.erp_pagar_rateio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_pagar_rateio_select_strict ON public.erp_pagar_rateio;
CREATE POLICY erp_pagar_rateio_select_strict ON public.erp_pagar_rateio
  FOR SELECT USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

DROP POLICY IF EXISTS erp_pagar_rateio_modify_strict ON public.erp_pagar_rateio;
CREATE POLICY erp_pagar_rateio_modify_strict ON public.erp_pagar_rateio
  FOR ALL USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

REVOKE ALL ON public.erp_pagar_rateio FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_pagar_rateio TO authenticated;

-- RD-95: "?" dos campos novos (erp_ajuda_campo, rota da tela). Idempotente.
INSERT INTO public.erp_ajuda_campo (rota, chave, grupo, ordem, rotulo, status, versao, exemplo, vertical, erro_comum, para_que_serve, o_que_preencher)
VALUES
  ('/dashboard/financeiro/nova-despesa', 'financeiro.despesa.rateio', 'Financeiro · Nova despesa', 17,
   'Rateio entre centros de custo', 'publicado', 1,
   'Aluguel do galpão R$ 3.000: 60% Obra Ipê, 40% Administrativo.',
   'gestao_empresarial',
   'Deixar a soma dos percentuais diferente de 100%: o valor do lançamento não fecha com a divisão.',
   'Divide um mesmo gasto entre mais de um centro de custo/obra, por percentual. Cada parte entra no resultado do seu centro — útil quando uma conta serve mais de uma obra.',
   'Ative "Dividir entre centros de custo", escolha cada centro e informe o percentual de cada um. A soma precisa dar 100%. O valor em R$ de cada parte é calculado a partir do valor do lançamento.')
ON CONFLICT (chave) DO NOTHING;
