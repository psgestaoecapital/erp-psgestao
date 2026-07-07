-- FIX-CATEGORIA-AMBIGUOUS + FEATURE-CURADORIA (07/07):
--
-- BUG (print CEO prod): "column reference codigo is ambiguous" na busca.
-- Causa: plpgsql RETURNS TABLE com OUT param 'codigo' colide com coluna
-- 'codigo' do CTE dentro do proprio RETURN QUERY. Solucao: adicionar
-- pragma #variable_conflict use_column (colunas ganham sobre OUT params)
-- e qualificar todas as referencias com o alias do CTE (filtrada.codigo,
-- dedup.codigo). Assim OUT params permanecem com nomes originais e o
-- frontend nao quebra.
--
-- FEATURE-CURADORIA (opcao C CEO, autorizado):
-- 1. ADD COLUMN sugerida_global boolean DEFAULT false em erp_plano_contas
-- 2. fn_plano_contas_criar_inline marca sugerida_global=true na criacao
--    (candidata a virar template global apos aprovacao CEO)
-- 3. Nova RPC fn_plano_contas_aprovar_global (SO admin/acesso_total/
--    adm_investimentos) promove categoria custom a global copiando com
--    company_id=NULL e desmarcando sugerida_global da original.
--    Idempotente: se ja existe global com esse codigo, so desmarca.
--
-- Aplicada via MCP apply_migration em 2026-07-07 (success:true).

-- ============================================================
-- Nova coluna: sugerida_global
-- ============================================================
ALTER TABLE public.erp_plano_contas
  ADD COLUMN IF NOT EXISTS sugerida_global boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.erp_plano_contas.sugerida_global IS
  'true = criada via fn_plano_contas_criar_inline por cliente. Candidata a virar template global (aprovacao via fn_plano_contas_aprovar_global — so admin/CEO).';

-- ============================================================
-- fn_plano_contas_buscar — corrigido ambiguidade
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_plano_contas_buscar(
  p_company_id uuid,
  p_termo text DEFAULT NULL,
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
#variable_conflict use_column
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
    SELECT DISTINCT ON (filtrada.codigo)
      filtrada.codigo, filtrada.descricao, filtrada.grupo, filtrada.tipo,
      filtrada.nivel, filtrada.pai_codigo, filtrada.is_totalizador, filtrada.origem
    FROM filtrada
    ORDER BY filtrada.codigo, filtrada.prio
  )
  SELECT dedup.codigo, dedup.descricao, dedup.grupo, dedup.tipo,
         dedup.nivel, dedup.pai_codigo, dedup.is_totalizador, dedup.origem
  FROM dedup
  ORDER BY dedup.is_totalizador ASC, dedup.codigo ASC
  LIMIT 50;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_plano_contas_buscar(uuid, text, text)
  TO authenticated, service_role;

-- ============================================================
-- fn_plano_contas_arvore — corrigido ambiguidade
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
#variable_conflict use_column
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
  SELECT DISTINCT ON (todos.codigo)
    todos.codigo, todos.descricao, todos.grupo, todos.tipo,
    todos.nivel, todos.pai_codigo, todos.is_totalizador, todos.origem
  FROM todos
  ORDER BY todos.codigo, todos.prio;
END $$;

GRANT EXECUTE ON FUNCTION public.fn_plano_contas_arvore(uuid, text)
  TO authenticated, service_role;

-- ============================================================
-- fn_plano_contas_criar_inline — set sugerida_global=true (curadoria)
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
#variable_conflict use_column
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
  FROM public.erp_plano_contas pc
  WHERE pc.codigo = btrim(p_pai_codigo)
    AND (pc.company_id = p_company_id OR pc.company_id IS NULL)
  ORDER BY (pc.company_id = p_company_id) DESC NULLS LAST
  LIMIT 1;

  IF v_pai.id IS NULL THEN
    RAISE EXCEPTION 'pai_nao_encontrado: %', p_pai_codigo;
  END IF;
  IF COALESCE(v_pai.nivel, 0) >= 3 THEN
    RAISE EXCEPTION 'nivel_maximo_atingido (3)';
  END IF;

  SELECT COALESCE(
    MAX(NULLIF(split_part(pc.codigo, '.', v_pai.nivel + 1), '')::int),
    0
  ) + 1
  INTO v_next
  FROM public.erp_plano_contas pc
  WHERE pc.pai_codigo = btrim(p_pai_codigo)
    AND (pc.company_id = p_company_id OR pc.company_id IS NULL)
    AND split_part(pc.codigo, '.', v_pai.nivel + 1) ~ '^\d+$';

  IF v_next > 99 THEN
    RAISE EXCEPTION 'sem_slot_disponivel (todos os 99 filhos ocupados sob %)', p_pai_codigo;
  END IF;

  v_novo_codigo := btrim(p_pai_codigo) || '.' || lpad(v_next::text, 2, '0');

  -- CURADORIA: sugerida_global=true. Candidata a template global.
  -- So CEO/admin promove via fn_plano_contas_aprovar_global.
  INSERT INTO public.erp_plano_contas
    (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel,
     ativo, is_totalizador, sugerida_global)
  VALUES
    (p_company_id, v_novo_codigo, btrim(p_descricao),
     v_pai.grupo, v_pai.tipo, btrim(p_pai_codigo), v_pai.nivel + 1,
     true, false, true);

  RETURN QUERY
  SELECT v_novo_codigo, btrim(p_descricao), v_pai.grupo, v_pai.tipo,
         v_pai.nivel + 1, btrim(p_pai_codigo);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_plano_contas_criar_inline(uuid, text, text)
  TO authenticated, service_role;

-- ============================================================
-- fn_plano_contas_aprovar_global — SO admin/acesso_total (opcao C CEO)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_plano_contas_aprovar_global(
  p_categoria_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_orig record;
  v_ja_global uuid;
  v_novo_id uuid;
BEGIN
  SELECT lower(COALESCE(u.role, '')) INTO v_role
  FROM public.users u WHERE u.id = auth.uid();

  IF v_role NOT IN ('adm','acesso_total','adm_investimentos') THEN
    RAISE EXCEPTION 'apenas_admin_promove_global';
  END IF;

  SELECT * INTO v_orig FROM public.erp_plano_contas WHERE id = p_categoria_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'categoria_nao_encontrada';
  END IF;

  IF v_orig.company_id IS NULL THEN
    RAISE EXCEPTION 'categoria_ja_e_global';
  END IF;

  SELECT id INTO v_ja_global FROM public.erp_plano_contas
   WHERE company_id IS NULL AND codigo = v_orig.codigo LIMIT 1;

  IF v_ja_global IS NOT NULL THEN
    UPDATE public.erp_plano_contas SET sugerida_global = false WHERE id = p_categoria_id;
    RETURN jsonb_build_object('sucesso', true, 'ja_existia', true, 'global_id', v_ja_global);
  END IF;

  INSERT INTO public.erp_plano_contas
    (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel,
     ativo, is_totalizador, sugerida_global)
  VALUES
    (NULL, v_orig.codigo, v_orig.descricao, v_orig.grupo, v_orig.tipo,
     v_orig.pai_codigo, v_orig.nivel, true, v_orig.is_totalizador, false)
  RETURNING id INTO v_novo_id;

  UPDATE public.erp_plano_contas SET sugerida_global = false WHERE id = p_categoria_id;

  RETURN jsonb_build_object('sucesso', true, 'ja_existia', false, 'global_id', v_novo_id);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_plano_contas_aprovar_global(uuid)
  TO authenticated, service_role;
