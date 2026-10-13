-- ============================================================
-- fn_grupo_empresa — resolve o GRUPO de qualquer empresa (peça genérica).
-- Base do "Dashboard Consolidado" (aba Início): dado uma empresa, devolve o
-- grupo dela (dashboard_grupos + dashboard_grupos_empresas) e os company_ids a
-- consolidar. Se não estiver em grupo nenhum → devolve ela mesma (N=1) — a tela
-- nunca quebra. Toda a família consolidada (fn_psgc_dre_horizontal, cards, drill)
-- passa a receber os company_ids daqui — nada hardcoded de empresa/CNPJ.
--
-- Pilar 2 (multi-tenant): SECURITY DEFINER + guard de escopo. Só considera os
-- membros do grupo que o usuário TEM acesso (get_user_company_ids) — a matriz
-- nunca enxerga empresas de outro grupo/fora do seu acesso. Escolhe o grupo com
-- MAIS membros acessíveis (o de consolidação) quando a empresa está em vários.
--
-- Retorno jsonb:
--   { ok, grupo_id, grupo_nome, is_grupo (>1 empresa acessível),
--     company_ids uuid[], empresas: [{id, nome_fantasia, cnpj, ordem}] }
-- Aplicada via MCP em 2026-07-30 — versionada aqui pra cristalizar drift.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_grupo_empresa(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_admin      boolean := public.is_admin();
  v_grupo_id   uuid;
  v_grupo_nome text;
  v_ids        uuid[];
  v_empresas   jsonb;
BEGIN
  IF p_company_id IS NULL
     OR (NOT v_admin AND p_company_id NOT IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  -- grupo (que contém a empresa) com MAIS membros acessíveis
  SELECT ge.grupo_id INTO v_grupo_id
  FROM dashboard_grupos_empresas ge
  WHERE ge.grupo_id IN (SELECT grupo_id FROM dashboard_grupos_empresas WHERE company_id = p_company_id)
    AND (v_admin OR ge.company_id IN (SELECT public.get_user_company_ids()))
  GROUP BY ge.grupo_id
  ORDER BY count(*) DESC, ge.grupo_id
  LIMIT 1;

  IF v_grupo_id IS NOT NULL THEN
    SELECT nome INTO v_grupo_nome FROM dashboard_grupos WHERE id = v_grupo_id;
    SELECT array_agg(c.id ORDER BY x.ordem NULLS LAST, c.nome_fantasia),
           jsonb_agg(jsonb_build_object(
             'id', c.id, 'nome_fantasia', COALESCE(c.nome_fantasia, c.razao_social),
             'cnpj', c.cnpj, 'ordem', x.ordem
           ) ORDER BY x.ordem NULLS LAST, c.nome_fantasia)
      INTO v_ids, v_empresas
    FROM dashboard_grupos_empresas x
    JOIN companies c ON c.id = x.company_id
    WHERE x.grupo_id = v_grupo_id
      AND (v_admin OR x.company_id IN (SELECT public.get_user_company_ids()));
  END IF;

  -- fallback: empresa sozinha (nunca quebra a tela)
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    SELECT COALESCE(c.nome_fantasia, c.razao_social, 'Empresa'),
           ARRAY[c.id],
           jsonb_build_array(jsonb_build_object(
             'id', c.id, 'nome_fantasia', COALESCE(c.nome_fantasia, c.razao_social),
             'cnpj', c.cnpj, 'ordem', 0))
      INTO v_grupo_nome, v_ids, v_empresas
    FROM companies c WHERE c.id = p_company_id;
    v_grupo_id := NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'grupo_id', v_grupo_id,
    'grupo_nome', COALESCE(v_grupo_nome, 'Empresa'),
    'is_grupo', (COALESCE(array_length(v_ids,1),1) > 1),
    'company_ids', to_jsonb(v_ids),
    'empresas', COALESCE(v_empresas, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_grupo_empresa(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_grupo_empresa(uuid) TO authenticated;
