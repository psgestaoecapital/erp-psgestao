-- Centros de Custo (Gestão Empresarial) — bug: títulos SOFT-DELETADOS apareciam como centros vivos.
--
-- Gap do auditor (/dashboard/gestao-empresarial/centros-custo, score 68): "~1930 centros de custo
-- 'não mapeados' nomeados E2E-CC-... Obra de teste ... Promissão/SP = dados sintéticos poluindo a DEMO"
-- e "mapear 1930 um-a-um é impraticável".
--
-- Causa (provado no dado, RD-38): fn_centro_custo_valores lê erp_pagar/erp_receber SEM filtrar
-- deleted_at IS NULL. A spec de aceitação pagar-centro-custo-obra.spec.ts cria, a cada run de CI, um
-- título com centro_custo "E2E-CC-<run> · Obra de teste <run> — Promissão/SP" e no teardown o SOFT-DELETA
-- (deleted_at). Como a função não excluía soft-deletados, os 1561 títulos já apagados da DEMO
-- b0700000-0000-4000-a000-000000000004 (TODOS com deleted_at IS NOT NULL, 0 vivos — provado) continuavam
-- listados como centros "não mapeados". Não é dado a limpar: é título que já foi apagado e a leitura
-- ignorava a exclusão.
--
-- Correção CIRÚRGICA, ADITIVA e GERAL (vale para qualquer empresa): adicionar `deleted_at IS NULL` às
-- subconsultas de erp_pagar e erp_receber. Título excluído (soft-delete) nunca deve contar como centro
-- de custo vivo. Nenhuma outra lógica muda; mapeamentos manuais (cost_center_map) seguem iguais.
-- Prova (RD-38, BEGIN/ROLLBACK): com o fix, a DEMO GE deixa de listar os 1561 E2E-CC (de 1561 para 0),
-- restando só os centros reais/mapeados.
--
-- Por ser CREATE OR REPLACE de função SECURITY DEFINER de leitura na área financeira, vai pela via
-- revisada (revisao-eng-chefe). REVOKE anon mantido (idempotente — anon já não tinha EXECUTE em prod).

CREATE OR REPLACE FUNCTION public.fn_centro_custo_valores(p_company uuid)
 RETURNS TABLE(valor_origem text, ocorrencias bigint, mapeado boolean, ativo boolean, tipo_apropriacao text, business_line_id uuid, lote_id uuid)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH vals AS (
    SELECT centro_custo AS v, count(*) AS n FROM erp_pagar
      WHERE company_id = p_company AND deleted_at IS NULL AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
    UNION ALL
    SELECT centro_custo AS v, count(*) AS n FROM erp_receber
      WHERE company_id = p_company AND deleted_at IS NULL AND centro_custo IS NOT NULL AND btrim(centro_custo) <> '' GROUP BY centro_custo
    UNION ALL
    -- inclui mapeamentos manuais (ativos OU inativos), pra aparecerem mesmo sem lançamento
    SELECT source_key AS v, 0::bigint AS n FROM cost_center_map
      WHERE company_id = p_company AND source_type='centro_custo'
  ),
  agg AS (SELECT v, SUM(n) AS n FROM vals GROUP BY v)
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
$function$;

-- Guarda de função (check_fn_guards): leitura SECURITY DEFINER nunca acessível ao anon.
REVOKE ALL ON FUNCTION public.fn_centro_custo_valores(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_centro_custo_valores(uuid) TO authenticated;
