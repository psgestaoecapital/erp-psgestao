-- ========================================================================
-- FC PISOS · Plano de contas exclusivo por empresa
-- Regra: empresa com plano proprio nao ve o template global.
--        Empresa sem a flag continua exatamente como hoje.
-- ========================================================================

-- 1) A flag (aditiva, default preserva o comportamento atual)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS plano_contas_proprio boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.plano_contas_proprio IS
  'true = a empresa usa SOMENTE o proprio plano de contas gerencial (o template global nao aparece nas listas). false (padrao) = template global + contas proprias, deduplicado por codigo.';

-- 2) Busca (autocomplete da categoria DRE em contas a pagar/receber)
CREATE OR REPLACE FUNCTION public.fn_plano_contas_buscar(
  p_company_id uuid, p_termo text DEFAULT NULL::text, p_aplicacao text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descricao text, grupo text, tipo text, nivel integer,
               pai_codigo text, is_totalizador boolean, origem text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_exclusivo boolean := false;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  SELECT COALESCE(c.plano_contas_proprio, false) INTO v_exclusivo
    FROM public.companies c WHERE c.id = p_company_id;

  -- trava anti-combo-vazio: so isola se a empresa realmente tem plano proprio ativo
  IF v_exclusivo AND NOT EXISTS (
    SELECT 1 FROM public.erp_plano_contas pc
     WHERE pc.company_id = p_company_id AND pc.ativo = true
  ) THEN
    v_exclusivo := false;
  END IF;

  RETURN QUERY
  WITH filtrada AS (
    SELECT pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.pai_codigo, pc.is_totalizador,
      CASE WHEN pc.company_id IS NULL THEN 'global' ELSE 'empresa' END AS origem,
      CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END AS prio
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND ( pc.company_id = p_company_id
         OR (pc.company_id IS NULL AND NOT v_exclusivo) )
      AND ( p_aplicacao IS NULL
        OR (p_aplicacao = 'receber' AND pc.tipo = 'receita')
        OR (p_aplicacao = 'pagar' AND pc.tipo IN ('despesa','custo','investimento','financeiro')) )
      AND ( p_termo IS NULL OR btrim(p_termo) = ''
        OR pc.codigo ILIKE '%' || btrim(p_termo) || '%'
        OR pc.descricao ILIKE '%' || btrim(p_termo) || '%' )
  ),
  dedup AS (
    SELECT DISTINCT ON (filtrada.codigo)
      filtrada.codigo, filtrada.descricao, filtrada.grupo, filtrada.tipo,
      filtrada.nivel, filtrada.pai_codigo, filtrada.is_totalizador, filtrada.origem
    FROM filtrada ORDER BY filtrada.codigo, filtrada.prio
  )
  SELECT dedup.codigo, dedup.descricao, dedup.grupo, dedup.tipo, dedup.nivel,
         dedup.pai_codigo, dedup.is_totalizador, dedup.origem
  FROM dedup ORDER BY dedup.is_totalizador ASC, dedup.codigo ASC LIMIT 50;
END $function$;

-- 3) Arvore (tela Plano de Contas e seletores hierarquicos)
CREATE OR REPLACE FUNCTION public.fn_plano_contas_arvore(
  p_company_id uuid, p_aplicacao text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descricao text, grupo text, tipo text, nivel integer,
               pai_codigo text, is_totalizador boolean, origem text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_exclusivo boolean := false;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  SELECT COALESCE(c.plano_contas_proprio, false) INTO v_exclusivo
    FROM public.companies c WHERE c.id = p_company_id;

  IF v_exclusivo AND NOT EXISTS (
    SELECT 1 FROM public.erp_plano_contas pc
     WHERE pc.company_id = p_company_id AND pc.ativo = true
  ) THEN
    v_exclusivo := false;
  END IF;

  RETURN QUERY
  WITH todos AS (
    SELECT pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.pai_codigo, pc.is_totalizador,
      CASE WHEN pc.company_id IS NULL THEN 'global' ELSE 'empresa' END AS origem,
      CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END AS prio
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND ( pc.company_id = p_company_id
         OR (pc.company_id IS NULL AND NOT v_exclusivo) )
      AND ( p_aplicacao IS NULL
        OR (p_aplicacao = 'receber' AND pc.tipo = 'receita')
        OR (p_aplicacao = 'pagar' AND pc.tipo IN ('despesa','custo','investimento','financeiro')) )
  )
  SELECT DISTINCT ON (todos.codigo)
    todos.codigo, todos.descricao, todos.grupo, todos.tipo, todos.nivel,
    todos.pai_codigo, todos.is_totalizador, todos.origem
  FROM todos ORDER BY todos.codigo, todos.prio;
END $function$;

-- 4) Guardas de acesso (SECURITY DEFINER): nunca anon; só usuário autenticado (guarda interna por
-- get_user_company_ids) e service_role. Preserva os grants que já existiam nestas funções.
REVOKE ALL ON FUNCTION public.fn_plano_contas_buscar(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_plano_contas_arvore(uuid, text)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_buscar(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_arvore(uuid, text)       TO authenticated, service_role;
