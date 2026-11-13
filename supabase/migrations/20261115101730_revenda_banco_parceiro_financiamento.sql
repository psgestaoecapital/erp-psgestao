-- ============================================================
-- Chamado #8162 · Revenda · Receita de intermediação de financiamento (ETAPA 1 — banco)
-- Code: rodrigo-code
--
-- Hoje o banco do financiamento na venda/negociação é TEXTO LIVRE (veic_venda.banco_nome,
-- veic_negociacao.banco_nome) e o retorno do banco (veic_venda.retorno_banco) é só receita
-- na margem — não vira título a receber nem tem cadastro de parceiros.
--
-- Esta etapa cria APENAS o cadastro de "Bancos parceiros" (financiamento), por empresa,
-- separado das contas bancárias da própria empresa (erp_banco_*). Aditiva, RLS por company_id.
-- Nada existente é alterado; a seleção na venda, a geração da receita e o painel vêm em etapas
-- seguintes (via revisada, financeiro/receita).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.veic_banco_parceiro (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  retorno_pct    numeric,          -- % de retorno sobre o valor financiado (ex.: 2 = 2%)
  prazo_dias     int,              -- prazo médio de pagamento do retorno, em dias
  ativo          boolean NOT NULL DEFAULT true,
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

COMMENT ON TABLE public.veic_banco_parceiro IS
  'Bancos parceiros de financiamento da revenda (chamado #8162). NÃO confundir com erp_banco_* (contas da própria empresa). Escopo por company_id.';
COMMENT ON COLUMN public.veic_banco_parceiro.retorno_pct IS
  'Percentual de retorno sobre o valor financiado. NULL = não informado (nunca zero implícito).';
COMMENT ON COLUMN public.veic_banco_parceiro.prazo_dias IS
  'Prazo médio, em dias, até o banco pagar o retorno; usado para o vencimento do título a receber (etapa seguinte).';

CREATE INDEX IF NOT EXISTS ix_veic_banco_parceiro_company
  ON public.veic_banco_parceiro (company_id);
-- um nome de banco não se repete na mesma empresa (case/space-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_banco_parceiro_company_nome
  ON public.veic_banco_parceiro (company_id, lower(btrim(nome)));

ALTER TABLE public.veic_banco_parceiro ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.veic_banco_parceiro'::regclass
      AND polname = 'veic_banco_parceiro_rw'
  ) THEN
    CREATE POLICY veic_banco_parceiro_rw ON public.veic_banco_parceiro
      FOR ALL USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
      WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;

REVOKE ALL ON TABLE public.veic_banco_parceiro FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veic_banco_parceiro TO authenticated;
GRANT ALL ON public.veic_banco_parceiro TO service_role;
