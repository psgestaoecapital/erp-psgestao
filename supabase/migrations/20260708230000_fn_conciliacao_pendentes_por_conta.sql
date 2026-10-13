-- Camada 1/Fatia 1 · item 6: badge de conciliações pendentes por conta bancária.
-- Conta pendentes de conciliacao_movimento (status=pendente) agrupados pela conta
-- do lote (conciliacao_lote.conta_bancaria_id). Guard multi-tenant (P2).
CREATE OR REPLACE FUNCTION public.fn_conciliacao_pendentes_por_conta(p_company_id uuid)
 RETURNS TABLE(conta_bancaria_id uuid, pendentes bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.conta_bancaria_id, count(*)::bigint AS pendentes
  FROM public.conciliacao_movimento m
  JOIN public.conciliacao_lote l ON l.id = m.lote_id
  WHERE m.status = 'pendente'
    AND m.company_id = p_company_id
    AND p_company_id IN (SELECT public.get_user_company_ids())
    AND l.conta_bancaria_id IS NOT NULL
  GROUP BY l.conta_bancaria_id
$function$;

GRANT EXECUTE ON FUNCTION public.fn_conciliacao_pendentes_por_conta(uuid) TO authenticated;
