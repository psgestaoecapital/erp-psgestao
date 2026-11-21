-- PDCA GE · /dashboard/gestao-empresarial/centros-custo · auditor_pdca_2 17/11
-- [CRÍTICO · SEGURANÇA / LGPD / RLS] Vazamento CROSS-TENANT em fn_centro_custo_valores.
--
-- Causa (provado RD-38): a função é STABLE SECURITY DEFINER e filtra APENAS
-- "WHERE company_id = p_company", SEM guarda de empresa. Como SECURITY DEFINER
-- ignora a RLS, QUALQUER usuário logado podia chamar a RPC com um p_company
-- ARBITRÁRIO (o UUID da empresa não é segredo — aparece em URL/export) e enumerar
-- de OUTRA empresa: nomes dos centros de custo (valor_origem), nº de ocorrências
-- por centro em erp_pagar/erp_receber (= volume/atividade), tipo_apropriacao,
-- business_line_id e lote_id. É a ÚNICA SECURITY DEFINER da família sem guarda —
-- as irmãs (fn_centro_custo_mapear/_excluir/_reativar, fn_ge_regra_rateio_salvar)
-- já têm "IF NOT (... IN (SELECT get_user_company_ids()) OR is_admin())".
--
-- Correção (aditiva, CREATE OR REPLACE): converter para plpgsql só para poder
-- barrar com a MESMA guarda das irmãs no topo (RAISE 42501). A QUERY é IDÊNTICA
-- à versão viva (20261110120615, que já ignora soft-delete) — nenhum dado de
-- cliente é alterado, só a leitura passa a ser negada fora da empresa do usuário.
-- Único caller é o front (page.tsx) como o usuário logado; sem callers server-side.

CREATE OR REPLACE FUNCTION public.fn_centro_custo_valores(p_company uuid)
 RETURNS TABLE(valor_origem text, ocorrencias bigint, mapeado boolean, ativo boolean, tipo_apropriacao text, business_line_id uuid, lote_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Guarda multi-empresa (SECURITY DEFINER ignora RLS): sem ela, enumeração cross-tenant.
  IF NOT (p_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'sem acesso a empresa' USING ERRCODE = '42501';
  END IF;

  -- cast ::text: erp_pagar/erp_receber.centro_custo é varchar; o RETURNS TABLE
  -- declara text e o RETURN QUERY do plpgsql exige o tipo exato.
  RETURN QUERY
  WITH vals AS (
    SELECT centro_custo::text AS v, count(*) AS n FROM erp_pagar
      WHERE company_id = p_company AND deleted_at IS NULL AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
    UNION ALL
    SELECT centro_custo::text AS v, count(*) AS n FROM erp_receber
      WHERE company_id = p_company AND deleted_at IS NULL AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
    UNION ALL
    -- inclui mapeamentos manuais (ativos OU inativos), pra aparecerem mesmo sem lançamento
    SELECT source_key::text AS v, 0::bigint AS n FROM cost_center_map
      WHERE company_id = p_company AND source_type='centro_custo'
  ),
  agg AS (SELECT v, SUM(n)::bigint AS n FROM vals GROUP BY v)
  SELECT agg.v, agg.n, (m.id IS NOT NULL), COALESCE(m.ativo, false),
         m.tipo_apropriacao, m.business_line_id, m.lote_id
  FROM agg
  LEFT JOIN LATERAL (
    SELECT cm.id, cm.ativo, cm.tipo_apropriacao, cm.business_line_id, cm.lote_id
    FROM cost_center_map cm
    WHERE cm.company_id = p_company AND cm.source_type='centro_custo' AND cm.source_key = agg.v
    ORDER BY cm.ativo DESC, cm.priority DESC NULLS LAST LIMIT 1
  ) m ON TRUE
  ORDER BY (m.id IS NOT NULL AND m.ativo), agg.n DESC;
END;
$function$;

-- ACL explícita (mantém o estado da 20261110120615): nunca anon.
REVOKE ALL ON FUNCTION public.fn_centro_custo_valores(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_centro_custo_valores(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_centro_custo_valores(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_centro_custo_valores(uuid) TO service_role;
