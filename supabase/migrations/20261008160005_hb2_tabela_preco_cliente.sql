-- Hub · HB2 · Tabela de preço por cliente (pedido da FC Pisos / tabela BRF, CEO 08/10).
-- Genérico (nada por cliente): o serviço entra UMA vez no catálogo (projetos_servicos, com a CPU de custo); a tabela do
-- cliente dá preço por FAIXA de quantidade, ADICIONAIS por condição (turno/dia) em % configurável por tabela (ou preço
-- fixo por condição) e CÓDIGO EXTERNO do cliente por item e por condição. Só objetos novos; RLS por empresa; anon sem acesso.
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  cliente_id uuid,
  cliente_nome text,
  nome text NOT NULL CHECK (length(btrim(nome)) >= 2),
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  moeda text NOT NULL DEFAULT 'BRL',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco_condicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.projetos_tabela_preco(id) ON DELETE CASCADE,
  codigo text NOT NULL CHECK (length(btrim(codigo)) >= 1),
  nome text NOT NULL,
  adicional_pct numeric(7, 2) NOT NULL DEFAULT 0 CHECK (adicional_pct >= -100),
  UNIQUE (tabela_id, codigo)
);
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.projetos_tabela_preco(id) ON DELETE CASCADE,
  servico_id uuid NOT NULL REFERENCES public.projetos_servicos(id),
  unidade text NOT NULL,
  tipo text NOT NULL DEFAULT 'faixa' CHECK (tipo IN ('faixa', 'distancia', 'adicional')),
  faixa_de numeric(14, 3) NOT NULL DEFAULT 0 CHECK (faixa_de >= 0),
  faixa_ate numeric(14, 3),
  preco_base numeric(14, 4) NOT NULL CHECK (preco_base >= 0),
  codigo_externo text,
  CHECK (faixa_ate IS NULL OR faixa_ate > faixa_de)
);
CREATE INDEX IF NOT EXISTS ix_tp_item_busca ON public.projetos_tabela_preco_item (tabela_id, servico_id, faixa_de);
CREATE TABLE IF NOT EXISTS public.projetos_tabela_preco_item_condicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  item_id uuid NOT NULL REFERENCES public.projetos_tabela_preco_item(id) ON DELETE CASCADE,
  condicao_id uuid NOT NULL REFERENCES public.projetos_tabela_preco_condicao(id) ON DELETE CASCADE,
  preco_fixo numeric(14, 4) CHECK (preco_fixo IS NULL OR preco_fixo >= 0),
  codigo_externo text,
  UNIQUE (item_id, condicao_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projetos_tabela_preco','projetos_tabela_preco_condicao','projetos_tabela_preco_item','projetos_tabela_preco_item_condicao'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS pol_%1$s_empresa ON public.%1$I', t);
    EXECUTE format('CREATE POLICY pol_%1$s_empresa ON public.%1$I FOR ALL TO authenticated USING (company_id IN (SELECT get_user_company_ids())) WITH CHECK (company_id IN (SELECT get_user_company_ids()))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;

-- Preço de um serviço para o cliente: escolhe a faixa pela quantidade (faixa_de < qtd <= faixa_ate) e aplica a condição.
-- SECURITY INVOKER: a RLS das tabelas vale. Margem contra a CPU (custo_unitario_total do serviço).
CREATE OR REPLACE FUNCTION public.fn_projetos_preco_cliente(
  p_tabela_id uuid, p_servico_id uuid, p_quantidade numeric, p_condicao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_item projetos_tabela_preco_item; v_cond projetos_tabela_preco_condicao; v_ic projetos_tabela_preco_item_condicao;
        v_preco numeric; v_custo numeric;
BEGIN
  SELECT * INTO v_item FROM projetos_tabela_preco_item
   WHERE tabela_id = p_tabela_id AND servico_id = p_servico_id AND tipo <> 'adicional'
     AND (p_quantidade > faixa_de OR faixa_de = 0)
     AND (faixa_ate IS NULL OR p_quantidade <= faixa_ate)
   ORDER BY faixa_de DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_faixa'); END IF;
  v_preco := v_item.preco_base;
  IF p_condicao IS NOT NULL THEN
    SELECT * INTO v_cond FROM projetos_tabela_preco_condicao WHERE tabela_id = p_tabela_id AND codigo = p_condicao;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'condicao_desconhecida'); END IF;
    SELECT * INTO v_ic FROM projetos_tabela_preco_item_condicao WHERE item_id = v_item.id AND condicao_id = v_cond.id;
    v_preco := COALESCE(v_ic.preco_fixo, v_item.preco_base * (1 + v_cond.adicional_pct / 100));
  END IF;
  SELECT custo_unitario_total INTO v_custo FROM projetos_servicos WHERE id = p_servico_id;
  RETURN jsonb_build_object('ok', true, 'item_id', v_item.id, 'unidade', v_item.unidade,
    'faixa_de', v_item.faixa_de, 'faixa_ate', v_item.faixa_ate,
    'preco_unitario', round(v_preco, 2), 'total', round(v_preco * p_quantidade, 2),
    'codigo_externo', COALESCE(v_ic.codigo_externo, v_item.codigo_externo),
    'custo_unitario', v_custo,
    'margem_pct', CASE WHEN v_preco > 0 AND v_custo IS NOT NULL THEN round((v_preco - v_custo) / v_preco * 100, 1) END);
END $$;
REVOKE ALL ON FUNCTION public.fn_projetos_preco_cliente(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_preco_cliente(uuid, uuid, numeric, text) TO authenticated, service_role;
