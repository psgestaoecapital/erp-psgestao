-- Relatório Plano Gerencial × Contábil · RPC (SPEC CEO 22/09, FC Pisos valida em 01/10).
-- Expande F.cadastros.plano_contas_v2 (não é módulo novo). Genérico (RD-51). RD-52.
-- Mesma regra de isolação do #1715 (plano_contas_proprio) para o relatório bater com a tela.

CREATE OR REPLACE FUNCTION public.fn_plano_contas_relatorio(p_company_id uuid)
 RETURNS TABLE(
   origem text,
   ger_codigo text, ger_descricao text, ger_grupo text, ger_tipo text,
   ger_nivel integer, ger_is_totalizador boolean,
   cont_codigo text, cont_descricao text, cont_nivel integer,
   cont_analitica boolean, cont_codigo_antigo text,
   vinculo_observacao text)
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

  -- mesma regra de isolacao do #1715, para o relatorio bater com a tela
  SELECT COALESCE(c.plano_contas_proprio, false) INTO v_exclusivo
    FROM public.companies c WHERE c.id = p_company_id;
  IF v_exclusivo AND NOT EXISTS (
    SELECT 1 FROM public.erp_plano_contas pc
     WHERE pc.company_id = p_company_id AND pc.ativo = true) THEN
    v_exclusivo := false;
  END IF;

  RETURN QUERY
  WITH ger AS (
    SELECT DISTINCT ON (pc.codigo)
      pc.id, pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.is_totalizador
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND ( pc.company_id = p_company_id
         OR (pc.company_id IS NULL AND NOT v_exclusivo) )
    ORDER BY pc.codigo, (CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END)
  ),
  lado_gerencial AS (
    SELECT 'gerencial'::text AS origem,
           ger.codigo, ger.descricao, ger.grupo, ger.tipo, ger.nivel, ger.is_totalizador,
           cc.codigo, cc.descricao, cc.nivel, cc.analitica, cc.codigo_antigo,
           v.observacao
    FROM ger
    LEFT JOIN public.erp_conta_contabil_vinculo v
           ON v.plano_conta_id = ger.id
          AND v.company_id = p_company_id
          AND v.ativo = true
    LEFT JOIN public.erp_conta_contabil cc
           ON cc.id = v.conta_contabil_id
          AND cc.ativo = true
  ),
  lado_contabil_orfao AS (
    SELECT 'contabil_sem_vinculo'::text,
           NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::boolean,
           cc.codigo, cc.descricao, cc.nivel, cc.analitica, cc.codigo_antigo,
           NULL::text
    FROM public.erp_conta_contabil cc
    WHERE cc.company_id = p_company_id
      AND cc.ativo = true
      AND cc.analitica = true
      AND NOT EXISTS (
        SELECT 1 FROM public.erp_conta_contabil_vinculo v
         WHERE v.conta_contabil_id = cc.id AND v.ativo = true)
  )
  SELECT * FROM lado_gerencial
  UNION ALL
  SELECT * FROM lado_contabil_orfao
  ORDER BY 1, 2 NULLS LAST, 8 NULLS LAST;
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_contas_relatorio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_relatorio(uuid) TO authenticated, service_role;
