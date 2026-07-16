-- P&M · 3 tabelas que faltavam pra fechar o fluxo PDOIS (RD-26: OS=agency_jobs, Proposta/Orçamento=
-- agency_propostas, Fee=agency_clientes.fee_mensal JÁ existem — não recriar). Multi-tenant por
-- company_id (RD-45). RLS espelhada de agency_clientes (RD-52): (company_id IN get_user_company_ids()) OR is_admin().
-- Nota (RD-44): agency_clientes.contrato_id referencia erp_contratos (GE), NÃO agency_contratos —
-- o elo P&M é via agency_contratos.cliente_id.

CREATE TABLE IF NOT EXISTS public.agency_contratos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  cliente_id uuid REFERENCES public.agency_clientes(id),
  proposta_id uuid REFERENCES public.agency_propostas(id),
  tipo text NOT NULL CHECK (tipo IN ('recorrente','projeto')),
  fee_mensal numeric(14,2),
  valor_projeto numeric(14,2),
  dia_vencimento int,
  data_inicio date, data_fim date,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','ativo','suspenso','encerrado')),
  documentacao_ok boolean DEFAULT false,
  lancamento_id uuid,           -- elo GE (recorrência de receita)
  observacoes text,
  criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE public.agency_contratos ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_contratos_access ON public.agency_contratos
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
CREATE INDEX IF NOT EXISTS ix_agency_contratos_company ON public.agency_contratos(company_id);
CREATE INDEX IF NOT EXISTS ix_agency_contratos_cliente ON public.agency_contratos(cliente_id);

CREATE TABLE IF NOT EXISTS public.agency_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome text NOT NULL, empresa text,
  origem text NOT NULL CHECK (origem IN ('prospeccao_ia_fria','indicacao','trafego_pago','relacionamento')),
  canal_contato text,
  etapa text NOT NULL DEFAULT 'novo'
    CHECK (etapa IN ('novo','atendimento','reuniao_agendada','entendimento','proposta','negociacao','ganho','perdido')),
  reuniao_agendada_em timestamptz,
  valor_estimado numeric(14,2),
  responsavel_id uuid,
  cliente_id uuid REFERENCES public.agency_clientes(id),
  motivo_perda text, observacoes text,
  criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE public.agency_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_leads_access ON public.agency_leads
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
CREATE INDEX IF NOT EXISTS ix_agency_leads_company ON public.agency_leads(company_id);
CREATE INDEX IF NOT EXISTS ix_agency_leads_cliente ON public.agency_leads(cliente_id);

CREATE TABLE IF NOT EXISTS public.agency_comissao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid REFERENCES public.agency_jobs(id),
  proposta_id uuid REFERENCES public.agency_propostas(id),
  vendedor_id uuid,
  base_valor numeric(14,2),
  percentual numeric(5,2),
  valor_comissao numeric(14,2),
  competencia date,
  status text NOT NULL DEFAULT 'prevista' CHECK (status IN ('prevista','a_pagar','paga','cancelada')),
  lancamento_id uuid,           -- elo erp_pagar
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE public.agency_comissao ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_comissao_access ON public.agency_comissao
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
CREATE INDEX IF NOT EXISTS ix_agency_comissao_company ON public.agency_comissao(company_id);
CREATE INDEX IF NOT EXISTS ix_agency_comissao_competencia ON public.agency_comissao(company_id, competencia);
