-- HB1 · Resultado por obra — versão custo (CEO 08/10 · Diego/FC · Virada 01/11). Só leitura, objeto novo.
--   previsto   = Σ custo_unitario_previsto × quantidade_contratada dos itens da obra (sem excluídos);
--   compras    = contas a pagar ligadas ao centro de custo da obra (sem excluídas/canceladas e sem as que já
--                entram como viagem, para não contar duas vezes);
--   viagens    = lançamentos de viagem da obra (sem excluídos);
--   realizado  = compras + viagens;  resultado = faturado (fn_obras_receita) − realizado, calculado na tela.
-- Mesma guarda de fn_obras_receita: a empresa tem de ser do usuário.
CREATE OR REPLACE FUNCTION public.fn_obras_custo(p_company_ids uuid[])
 RETURNS TABLE(obra_id uuid, previsto numeric, compras numeric, viagens numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id,
         COALESCE((SELECT sum(i.custo_unitario_previsto * i.quantidade_contratada)
                     FROM public.projetos_obra_item i
                    WHERE i.obra_id = o.id AND i.excluido_em IS NULL), 0)::numeric(14,2),
         COALESCE((SELECT sum(p.valor) FROM public.erp_pagar p
                    WHERE o.centro_custo_id IS NOT NULL AND p.centro_custo_id = o.centro_custo_id
                      AND p.company_id = o.company_id AND p.deleted_at IS NULL AND p.status <> 'cancelado'
                      AND NOT EXISTS (SELECT 1 FROM public.erp_viagem_lancamento v WHERE v.pagar_id = p.id AND v.excluido_em IS NULL)), 0)::numeric(14,2),
         COALESCE((SELECT sum(v.valor) FROM public.erp_viagem_lancamento v
                    WHERE v.obra_id = o.id AND v.excluido_em IS NULL), 0)::numeric(14,2)
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT public.get_user_company_ids());
$function$;

REVOKE ALL ON FUNCTION public.fn_obras_custo(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_custo(uuid[]) TO authenticated, service_role;
