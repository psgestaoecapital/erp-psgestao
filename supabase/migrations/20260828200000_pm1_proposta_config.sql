-- SPEC PM-1 (PR-C) · config da aba Proposta. RD-58: settings que a tela expõe têm de ser REAIS
-- (armazenados + aplicados no editor) — nada de toggle que não faz nada.
-- Auditado: não existe tabela de config da agência (só agency_config_opcao, que é lista de opções).
-- Cria agency_proposta_config (1 linha por empresa). A numeração (prefixo/contador) fica de fora deste
-- PR: mora dentro de fn_agency_proposta_criar (mudá-la é reescrever a RPC) — não crio campo falso pra ela.

CREATE TABLE IF NOT EXISTS public.agency_proposta_config (
  company_id           uuid PRIMARY KEY,
  validade_dias        int NOT NULL DEFAULT 15,     -- prefill do vencimento da proposta
  condicao_padrao      text,                        -- prefill da condição de pagamento
  exigir_item_catalogo boolean NOT NULL DEFAULT false, -- true = todo item precisa vir do catálogo (sem avulso)
  desconto_max_pct     numeric(5,2),                -- NULL = sem limite; senão bloqueia desconto acima disso
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agency_proposta_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_proposta_config_rw ON public.agency_proposta_config;
CREATE POLICY agency_proposta_config_rw ON public.agency_proposta_config FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
