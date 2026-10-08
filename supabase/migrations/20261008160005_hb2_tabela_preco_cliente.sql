-- HB2 · Tabela de preço por cliente (pedido Diego/FC, CEO 08/10 "podemos sim"). Objetos NOVOS, genéricos (nada por cliente).
--   tabela (cliente, vigência, moeda) → itens com FAIXA de quantidade (faixa_de < qtd <= faixa_ate; ate NULL = sem teto)
--   → regras de adicional por condição (percentual da tabela; preço fixo por condição no item) → código externo por item+condição.
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  cliente_nome text NOT NULL,
  cliente_id uuid,
  nome text NOT NULL,
  moeda text NOT NULL DEFAULT 'BRL',
  vigencia_ini date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_ini)
);
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tabela_id uuid NOT NULL REFERENCES public.projetos_tabela_preco(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL,
  unidade text NOT NULL,
  eixo text NOT NULL DEFAULT 'quantidade' CHECK (eixo IN ('quantidade','distancia')),
  faixa_de numeric NOT NULL DEFAULT 0,
  faixa_ate numeric,
  preco_base numeric(14,4) NOT NULL CHECK (preco_base >= 0),
  adicional boolean NOT NULL DEFAULT false,
  precos_fixos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (faixa_ate IS NULL OR faixa_ate > faixa_de)
);
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco_regra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tabela_id uuid NOT NULL REFERENCES public.projetos_tabela_preco(id) ON DELETE CASCADE,
  condicao text NOT NULL CHECK (condicao IN ('noturno','sabado','domingo_feriado')),
  percentual numeric(7,2) NOT NULL CHECK (percentual >= 0),
  UNIQUE (tabela_id, condicao)
);
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco_codigo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tabela_id uuid NOT NULL REFERENCES public.projetos_tabela_preco(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL,
  condicao text NOT NULL DEFAULT 'normal' CHECK (condicao IN ('normal','noturno','sabado','domingo_feriado')),
  codigo_externo text NOT NULL,
  UNIQUE (tabela_id, servico_id, condicao)
);
CREATE INDEX IF NOT EXISTS projetos_tabela_preco_item_tab_idx ON public.projetos_tabela_preco_item (tabela_id, servico_id);
CREATE INDEX IF NOT EXISTS projetos_tabela_preco_company_idx ON public.projetos_tabela_preco (company_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projetos_tabela_preco','projetos_tabela_preco_item','projetos_tabela_preco_regra','projetos_tabela_preco_codigo'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_rls', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())', t || '_rls', t);
  END LOOP;
END $$;
