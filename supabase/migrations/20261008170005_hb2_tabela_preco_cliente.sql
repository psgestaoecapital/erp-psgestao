-- HB2 (fatia 1): tabela de preço por cliente — faixas de quantidade, adicionais por condição (turno/dia) e código
-- externo do cliente por item e condição. Genérico (nada por cliente). Só objetos NOVOS; RLS por empresa; sem acesso anon;
-- escrita só por funções (próxima fatia) — o cliente apenas lê.
CREATE TABLE IF NOT EXISTS public.erp_tabela_preco_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  cliente_id uuid,
  nome text NOT NULL CHECK (length(btrim(nome)) >= 2),
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  moeda text NOT NULL DEFAULT 'BRL',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE TABLE IF NOT EXISTS public.erp_tabela_preco_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.erp_tabela_preco_cliente(id),
  servico_ref text NOT NULL,
  servico_nome text NOT NULL,
  unidade text NOT NULL,
  faixa_de numeric(15,3) NOT NULL DEFAULT 0 CHECK (faixa_de >= 0),
  faixa_ate numeric(15,3),
  preco_base numeric(15,4) NOT NULL CHECK (preco_base >= 0),
  adicional bool NOT NULL DEFAULT false,
  CHECK (faixa_ate IS NULL OR faixa_ate > faixa_de)
);
CREATE TABLE IF NOT EXISTS public.erp_tabela_preco_condicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.erp_tabela_preco_cliente(id),
  condicao text NOT NULL,
  percentual numeric(7,3) CHECK (percentual IS NULL OR percentual >= 0),
  UNIQUE (tabela_id, condicao)
);
CREATE TABLE IF NOT EXISTS public.erp_tabela_preco_codigo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.erp_tabela_preco_cliente(id),
  servico_ref text NOT NULL,
  condicao text NOT NULL DEFAULT 'normal',
  codigo_externo text NOT NULL,
  preco_fixo numeric(15,4) CHECK (preco_fixo IS NULL OR preco_fixo >= 0),
  UNIQUE (tabela_id, servico_ref, condicao)
);
CREATE INDEX IF NOT EXISTS ix_tp_item_tabela ON public.erp_tabela_preco_item (tabela_id, servico_ref);
CREATE INDEX IF NOT EXISTS ix_tp_cliente_company ON public.erp_tabela_preco_cliente (company_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_tabela_preco_cliente','erp_tabela_preco_item','erp_tabela_preco_condicao','erp_tabela_preco_codigo'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())', t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
