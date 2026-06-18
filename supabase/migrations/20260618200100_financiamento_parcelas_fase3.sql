-- financiamentos-fase3 · cronograma + desembolso mensal

CREATE TABLE IF NOT EXISTS public.financiamento_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financiamento_id uuid NOT NULL REFERENCES public.financiamentos(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  numero integer NOT NULL,
  data_vencimento date NOT NULL,
  valor_parcela numeric NOT NULL,
  amortizacao numeric,
  juros numeric,
  saldo_apos numeric,
  status text DEFAULT 'aberta',
  created_at timestamptz DEFAULT now(),
  UNIQUE (financiamento_id, numero)
);

ALTER TABLE public.financiamento_parcelas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_fin_parcelas_sel ON public.financiamento_parcelas;
CREATE POLICY p_fin_parcelas_sel ON public.financiamento_parcelas
  FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

CREATE INDEX IF NOT EXISTS ix_fin_parcelas_venc
  ON public.financiamento_parcelas (company_id, data_vencimento);

GRANT SELECT ON public.financiamento_parcelas TO authenticated;
GRANT ALL    ON public.financiamento_parcelas TO service_role;

CREATE OR REPLACE VIEW public.v_financiamento_desembolso_mensal
WITH (security_invoker = true) AS
SELECT company_id,
       date_trunc('month', data_vencimento)::date AS mes,
       sum(valor_parcela) AS total_mes,
       count(DISTINCT financiamento_id) AS contratos
FROM public.financiamento_parcelas
WHERE status <> 'paga'
GROUP BY company_id, date_trunc('month', data_vencimento);

GRANT SELECT ON public.v_financiamento_desembolso_mensal TO authenticated, service_role;

COMMENT ON TABLE public.financiamento_parcelas IS
'financiamentos-fase3 · cronograma de parcelas (amortizacao/juros/saldo) por financiamento.';
COMMENT ON VIEW public.v_financiamento_desembolso_mensal IS
'financiamentos-fase3 · agrega desembolso mensal das parcelas em aberto (security_invoker=true respeita RLS).';
