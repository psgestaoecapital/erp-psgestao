-- PDCA GE · /dashboard/financeiro/conciliacao/inbox · auditor_pdca_2 17/11
-- [MAJOR · dado engana usuário, dispara em produção] O contador "extrato fechado"
-- divergia da lista. fn_conciliacao_conciliados (a LISTA) já EXCLUI movimentos cujo
-- título vinculado foi soft-deletado, mas conciliacao_lote.total_conciliados (coluna
-- gravada, lida direto na tela) e a barra de progresso NÃO aplicam a mesma exclusão.
-- Resultado provado (RD-38): lotes 7d80bc1c/9bf9df83 têm total_conciliados=3 mas 0
-- conciliados reais (os 3 títulos estão soft-deletados) -> a aba mostra "Conciliados (3)"
-- + "3 de 3 resolvidos · extrato fechado", enquanto a LISTA renderiza "Nenhum movimento
-- conciliado ainda". Hoje o gatilho é poluição e2e, mas o mesmo caminho dispara para
-- QUALQUER título de produção soft-deletado APÓS a conciliação.
--
-- Correção (ADITIVA): nova RPC que devolve, por lote, os contadores RECONCILIADOS com a
-- MESMA exclusão de soft-delete da lista. A tela passa a usar estes números no contador
-- e na barra; os conciliados órfãos ficam EXPLÍCITOS (conciliados_orfaos) para a UI avisar,
-- em vez de serem contados como "resolvidos". Não altera dado de cliente. SECURITY INVOKER
-- (igual às irmãs fn_conciliacao_inbox/_conciliados): a RLS de conciliacao_movimento
-- (rowsecurity=on) já restringe por empresa; filtra também por company_id/lote_id.
--   total = conciliados + conciliados_orfaos + ignorados + pendentes
--   resolvidos = conciliados + ignorados   (órfão NÃO é resolvido, NÃO é pendente)

CREATE OR REPLACE FUNCTION public.fn_conciliacao_lote_resumo(p_company_id uuid, p_lote_id uuid)
 RETURNS TABLE(total_movimentos bigint, conciliados bigint, conciliados_orfaos bigint, ignorados bigint, pendentes bigint, resolvidos bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH m AS (
    SELECT mv.status,
      (mv.status = 'conciliado' AND (
         (mv.lancamento_tabela = 'erp_pagar'   AND EXISTS (SELECT 1 FROM erp_pagar   p WHERE p.id = mv.lancamento_id AND p.deleted_at IS NOT NULL)) OR
         (mv.lancamento_tabela = 'erp_receber' AND EXISTS (SELECT 1 FROM erp_receber r WHERE r.id = mv.lancamento_id AND r.deleted_at IS NOT NULL))
      )) AS orfao
    FROM conciliacao_movimento mv
    WHERE mv.company_id = p_company_id AND mv.lote_id = p_lote_id
  )
  SELECT
    count(*)::bigint                                                                         AS total_movimentos,
    count(*) FILTER (WHERE status = 'conciliado' AND NOT orfao)::bigint                      AS conciliados,
    count(*) FILTER (WHERE status = 'conciliado' AND orfao)::bigint                          AS conciliados_orfaos,
    count(*) FILTER (WHERE status = 'ignorado')::bigint                                      AS ignorados,
    count(*) FILTER (WHERE status NOT IN ('conciliado','ignorado'))::bigint                  AS pendentes,
    (count(*) FILTER (WHERE status = 'conciliado' AND NOT orfao)
       + count(*) FILTER (WHERE status = 'ignorado'))::bigint                                AS resolvidos
  FROM m;
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_lote_resumo(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_conciliacao_lote_resumo(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_lote_resumo(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_lote_resumo(uuid, uuid) TO service_role;
