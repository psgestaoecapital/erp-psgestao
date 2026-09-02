-- Revenda de Veículos · Onda 3A (venda comercial, sem NF-e) · modelo de dados.
-- Depende das Ondas 1-2 (veic_veiculo, fn_veic_mudar_situacao). Dois diferenciais no schema:
--  §1 troca supervalorizada: valor_troca (o que foi dado) × valor_avaliacao (o que vale) → a
--     diferença é DESCONTO EMBUTIDO na venda, não custo do usado (senão as duas margens erram juntas).
--  §2 financiamento: o recebível tem devedor 'cliente' (entrada) e 'banco' (repasse) — não tudo no cliente.
-- Não recria financeiro: cada recebimento vira erp_receber via ref_externa (já existe). Multi-tenant + RLS.

CREATE TABLE IF NOT EXISTS public.veic_proposta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.veic_veiculo(id) ON DELETE CASCADE,
  numero text,
  cliente_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  cliente_nome text, cliente_doc text,
  valor_pedido numeric, valor_negociado numeric, desconto numeric,
  situacao text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta','aceita','recusada','expirada','cancelada')),
  validade_ate date,
  vendedor_nome text, observacao text,
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);

-- o veículo que entra na troca — dois valores (o diferencial §1)
CREATE TABLE IF NOT EXISTS public.veic_proposta_troca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  proposta_id uuid NOT NULL REFERENCES public.veic_proposta(id) ON DELETE CASCADE,
  chassi text, placa text, marca text, modelo text, ano_fabricacao int, ano_modelo int, km numeric,
  valor_troca numeric,       -- o que foi dado ao cliente na negociação
  valor_avaliacao numeric,   -- quanto a loja acha que o carro vale
  veiculo_id uuid REFERENCES public.veic_veiculo(id) ON DELETE SET NULL,  -- preenchido quando vira estoque
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.veic_reserva (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.veic_veiculo(id) ON DELETE CASCADE,
  proposta_id uuid REFERENCES public.veic_proposta(id) ON DELETE SET NULL,
  cliente_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  cliente_nome text,
  valor_sinal numeric, forma_sinal text, receber_id uuid REFERENCES public.erp_receber(id) ON DELETE SET NULL,
  reservado_ate date,
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa','convertida','expirada','cancelada')),
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);

CREATE TABLE IF NOT EXISTS public.veic_venda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.veic_veiculo(id) ON DELETE CASCADE,
  proposta_id uuid REFERENCES public.veic_proposta(id) ON DELETE SET NULL,
  numero text,
  cliente_id uuid REFERENCES public.erp_clientes(id) ON DELETE SET NULL,
  cliente_nome text, cliente_doc text,
  data_venda date NOT NULL DEFAULT CURRENT_DATE,
  valor_venda numeric,
  desconto_embutido_troca numeric,     -- §1: valor_troca − valor_avaliacao
  valor_entrada numeric, valor_financiado numeric,
  banco_nome text, retorno_banco numeric,   -- §2/§6: retorno do banco é receita da loja
  situacao text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta','faturada','entregue','cancelada')),
  nfe_id uuid,                          -- Onda 3B
  vendedor_nome text, observacao text,
  deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid
);

-- as parcelas → erp_receber; cada uma sabe QUEM deve (cliente × banco, §2)
CREATE TABLE IF NOT EXISTS public.veic_venda_recebimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  venda_id uuid NOT NULL REFERENCES public.veic_venda(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('entrada','financiamento','parcela','sinal','retorno_banco')),
  devedor text NOT NULL DEFAULT 'cliente' CHECK (devedor IN ('cliente','banco')),
  valor numeric NOT NULL, data_prevista date,
  forma_pagamento text, conta_bancaria_id uuid,
  receber_id uuid REFERENCES public.erp_receber(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_veic_venda_veiculo ON public.veic_venda (veiculo_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_veic_reserva_veiculo ON public.veic_reserva (veiculo_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_veic_proposta_veiculo ON public.veic_proposta (veiculo_id) WHERE deleted_at IS NULL;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['veic_proposta','veic_proposta_troca','veic_reserva','veic_venda','veic_venda_recebimento'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_rw', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
        USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
        WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin())$p$, t||'_rw', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $rls$;
