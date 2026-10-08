-- HB2 (fatia 1): tabela de preço por cliente — faixa de quantidade + adicional por condição (turno/dia)
-- + código externo do cliente. Objetos NOVOS, RLS por empresa, sem acesso anon. Nada hardcoded por cliente.
CREATE TABLE IF NOT EXISTS public.hub_tabela_preco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  cliente_id uuid,
  nome text NOT NULL,
  vigencia_ini date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim date,
  moeda text NOT NULL DEFAULT 'BRL',
  criado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.hub_tabela_preco_condicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_id uuid NOT NULL REFERENCES public.hub_tabela_preco(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  codigo text NOT NULL,                 -- ex.: normal, noturno, sabado, domingo_feriado
  nome text NOT NULL,
  adicional_pct numeric(7,2) NOT NULL DEFAULT 0,
  UNIQUE (tabela_id, codigo)
);
CREATE TABLE IF NOT EXISTS public.hub_tabela_preco_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_id uuid NOT NULL REFERENCES public.hub_tabela_preco(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  servico_ref text NOT NULL,
  unidade text NOT NULL,
  faixa_de numeric(15,3) NOT NULL DEFAULT 0,
  faixa_ate numeric(15,3),              -- NULL = sem limite
  preco_base numeric(15,4) NOT NULL,
  CHECK (faixa_ate IS NULL OR faixa_ate > faixa_de)
);
CREATE TABLE IF NOT EXISTS public.hub_tabela_preco_item_condicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_id uuid NOT NULL REFERENCES public.hub_tabela_preco(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  servico_ref text NOT NULL,
  condicao_codigo text NOT NULL,
  preco_fixo numeric(15,4),             -- se preenchido, vale no lugar do percentual
  codigo_externo text,                  -- código do item no cliente (proposta/medição/NFS-e)
  UNIQUE (tabela_id, servico_ref, condicao_codigo)
);
CREATE INDEX IF NOT EXISTS hub_tabela_preco_item_busca ON public.hub_tabela_preco_item (tabela_id, servico_ref, faixa_de);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hub_tabela_preco','hub_tabela_preco_condicao','hub_tabela_preco_item','hub_tabela_preco_item_condicao'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_empresa', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (company_id IN (SELECT public.get_user_company_ids())) WITH CHECK (company_id IN (SELECT public.get_user_company_ids()))', t||'_empresa', t);
  END LOOP;
END $$;

-- Preço de um serviço: escolhe a faixa pela quantidade e aplica a condição (preço fixo > percentual).
CREATE OR REPLACE FUNCTION public.fn_hub_preco_servico(p_tabela uuid, p_servico text, p_qtd numeric, p_condicao text DEFAULT 'normal')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_item record; v_cond record; v_fix numeric; v_ext text; v_preco numeric;
BEGIN
  SELECT * INTO v_item FROM hub_tabela_preco_item
   WHERE tabela_id = p_tabela AND servico_ref = p_servico AND faixa_de <= p_qtd
     AND (faixa_ate IS NULL OR p_qtd <= faixa_ate)
   ORDER BY faixa_de DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_faixa'); END IF;
  SELECT * INTO v_cond FROM hub_tabela_preco_condicao WHERE tabela_id = p_tabela AND codigo = COALESCE(p_condicao,'normal');
  SELECT preco_fixo, codigo_externo INTO v_fix, v_ext FROM hub_tabela_preco_item_condicao
   WHERE tabela_id = p_tabela AND servico_ref = p_servico AND condicao_codigo = COALESCE(p_condicao,'normal');
  v_preco := COALESCE(v_fix, round(v_item.preco_base * (1 + COALESCE(v_cond.adicional_pct,0)/100), 2));
  RETURN jsonb_build_object('ok', true, 'preco_unitario', v_preco, 'preco_base', v_item.preco_base,
    'faixa_de', v_item.faixa_de, 'faixa_ate', v_item.faixa_ate, 'unidade', v_item.unidade,
    'codigo_externo', v_ext, 'total', round(v_preco * p_qtd, 2));
END $$;
REVOKE ALL ON FUNCTION public.fn_hub_preco_servico(uuid,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_preco_servico(uuid,text,numeric,text) TO authenticated, service_role;
