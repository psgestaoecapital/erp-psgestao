-- FASE-1 CATEGORIAS DRE (07/07 · CEO autorizado):
-- 3 RPCs sobre erp_plano_contas — busca digitavel, arvore hierarquica,
-- criar categoria inline (Pilar 2 RLS multi-tenant + custom-only por empresa).
--
-- CONTEXTO: benchmark Aplix (registrado em erp_contexto_projeto). CEO pediu
-- paridade + busca digitavel + criar categoria inline. Auditoria confirmou
-- que erp_plano_contas ja tem hierarquia (pai_codigo string + nivel), tipo
-- receita/despesa/custo/financeiro/investimento, ativo, is_totalizador,
-- e template global (company_id NULL) + override por empresa. So faltam
-- as RPCs de acesso e a UI.
--
-- Aplicada via MCP apply_migration em 2026-07-07 (success:true).

-- ============================================================
-- RPC 1: fn_plano_contas_buscar
-- Busca por codigo OU descricao, com filtro por aplicacao (receber/pagar).
-- Merge de empresa + template global (empresa sobrescreve codigo duplicado).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_plano_contas_buscar(
  p_company_id uuid,
  p_termo text DEFAULT NULL,
  p_aplicacao text DEFAULT NULL  -- 'receber' | 'pagar' | NULL (sem filtro)
)
RETURNS TABLE (
  codigo text,
  descricao text,
  grupo text,
  tipo text,
  nivel integer,
  pai_codigo text,
  is_totalizador boolean,
  origem text  -- 'empresa' | 'global'
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  RETURN QUERY
  WITH filtrada AS (
    SELECT
      pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.pai_codigo,
      pc.is_totalizador,
      CASE WHEN pc.company_id IS NULL THEN 'global' ELSE 'empresa' END AS origem,
      CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END AS prio
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND (pc.company_id = p_company_id OR pc.company_id IS NULL)
      AND (
        p_aplicacao IS NULL
        OR (p_aplicacao = 'receber' AND pc.tipo = 'receita')
        OR (p_aplicacao = 'pagar' AND pc.tipo IN ('despesa','custo'))
      )
      AND (
        p_termo IS NULL OR btrim(p_termo) = ''
        OR pc.codigo ILIKE '%' || btrim(p_termo) || '%'
        OR pc.descricao ILIKE '%' || btrim(p_termo) || '%'
      )
  ),
  dedup AS (
    SELECT DISTINCT ON (codigo)
      codigo, descricao, grupo, tipo, nivel, pai_codigo, is_totalizador, origem
    FROM filtrada
    ORDER BY codigo, prio
  )
  SELECT d.codigo, d.descricao, d.grupo, d.tipo, d.nivel, d.pai_codigo,
         d.is_totalizador, d.origem
  FROM dedup d
  ORDER BY d.is_totalizador ASC, d.codigo ASC
  LIMIT 50;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_plano_contas_buscar(uuid, text, text)
  TO authenticated, service_role;

-- ============================================================
-- RPC 2: fn_plano_contas_arvore
-- Hierarquia completa (merge empresa + global).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_plano_contas_arvore(
  p_company_id uuid,
  p_aplicacao text DEFAULT NULL
)
RETURNS TABLE (
  codigo text,
  descricao text,
  grupo text,
  tipo text,
  nivel integer,
  pai_codigo text,
  is_totalizador boolean,
  origem text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  RETURN QUERY
  WITH todos AS (
    SELECT
      pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.pai_codigo,
      pc.is_totalizador,
      CASE WHEN pc.company_id IS NULL THEN 'global' ELSE 'empresa' END AS origem,
      CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END AS prio
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND (pc.company_id = p_company_id OR pc.company_id IS NULL)
      AND (
        p_aplicacao IS NULL
        OR (p_aplicacao = 'receber' AND pc.tipo = 'receita')
        OR (p_aplicacao = 'pagar' AND pc.tipo IN ('despesa','custo'))
      )
  )
  SELECT DISTINCT ON (t.codigo)
    t.codigo, t.descricao, t.grupo, t.tipo, t.nivel, t.pai_codigo,
    t.is_totalizador, t.origem
  FROM todos t
  ORDER BY t.codigo, t.prio;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_plano_contas_arvore(uuid, text)
  TO authenticated, service_role;

-- ============================================================
-- RPC 3: fn_plano_contas_criar_inline
-- Cria categoria custom da empresa. NUNCA polui template global.
-- Aloca proximo codigo disponivel (01..99) sob o pai.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_plano_contas_criar_inline(
  p_company_id uuid,
  p_descricao text,
  p_pai_codigo text
)
RETURNS TABLE (
  codigo text,
  descricao text,
  grupo text,
  tipo text,
  nivel integer,
  pai_codigo text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pai record;
  v_next int;
  v_novo_codigo text;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;
  IF p_pai_codigo IS NULL OR btrim(p_pai_codigo) = '' THEN
    RAISE EXCEPTION 'pai_codigo_obrigatorio';
  END IF;
  IF p_descricao IS NULL OR btrim(p_descricao) = '' THEN
    RAISE EXCEPTION 'descricao_obrigatoria';
  END IF;

  SELECT * INTO v_pai
  FROM public.erp_plano_contas
  WHERE codigo = btrim(p_pai_codigo)
    AND (company_id = p_company_id OR company_id IS NULL)
  ORDER BY (company_id = p_company_id) DESC NULLS LAST
  LIMIT 1;

  IF v_pai.id IS NULL THEN
    RAISE EXCEPTION 'pai_nao_encontrado: %', p_pai_codigo;
  END IF;
  IF COALESCE(v_pai.nivel, 0) >= 3 THEN
    RAISE EXCEPTION 'nivel_maximo_atingido (3)';
  END IF;

  SELECT COALESCE(
    MAX(NULLIF(split_part(codigo, '.', v_pai.nivel + 1), '')::int),
    0
  ) + 1
  INTO v_next
  FROM public.erp_plano_contas
  WHERE pai_codigo = btrim(p_pai_codigo)
    AND (company_id = p_company_id OR company_id IS NULL)
    AND split_part(codigo, '.', v_pai.nivel + 1) ~ '^\d+$';

  IF v_next > 99 THEN
    RAISE EXCEPTION 'sem_slot_disponivel (todos os 99 filhos ocupados sob %)', p_pai_codigo;
  END IF;

  v_novo_codigo := btrim(p_pai_codigo) || '.' || lpad(v_next::text, 2, '0');

  INSERT INTO public.erp_plano_contas
    (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel,
     ativo, is_totalizador)
  VALUES
    (p_company_id, v_novo_codigo, btrim(p_descricao),
     v_pai.grupo, v_pai.tipo, btrim(p_pai_codigo), v_pai.nivel + 1,
     true, false);

  RETURN QUERY
  SELECT v_novo_codigo, btrim(p_descricao), v_pai.grupo, v_pai.tipo,
         v_pai.nivel + 1, btrim(p_pai_codigo);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_plano_contas_criar_inline(uuid, text, text)
  TO authenticated, service_role;
