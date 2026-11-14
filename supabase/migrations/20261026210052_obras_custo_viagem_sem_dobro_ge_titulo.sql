-- HB1 · Resultado por obra — custo: corrige dupla contagem de viagem lançada no GE (desenvolvedor_4_g, 26/10).
--
-- PROVADO NO DADO (RD-38), empresa DEMO b0700000-...-000000000006:
--   DEMO-FC-001 (obra 5a016907-...): viagens (erp_viagem_lancamento) = R$2.460,35 E
--   compras (erp_pagar do centro de custo) = R$2.460,35 — o MESMO gasto de viagem, contado duas vezes.
--   fn_obras_custo devolvia compras 2460,35 + viagens 2460,35 = R$4.920,70 (custo real da viagem: R$2.460,35).
--   Com a correção: compras = 0 (nenhuma outra compra na obra) + viagens 2460,35 = R$2.460,35. 10 títulos GE vivos.
--
-- CAUSA: o guarda anti-dobro de 20261008140005 exclui as contas a pagar "que já entram como viagem" por
--   erp_viagem_lancamento.pagar_id. Mas fn_viagem_lancar_ge NUNCA grava pagar_id no lançamento — o vínculo
--   conta-a-pagar ↔ viagem fica em erp_viagem_ge_titulo.pagar_id. Logo o guarda nunca casava e a viagem
--   lançada no GE voltava em "compras" além de "viagens". A intenção já estava no comentário da função
--   ("sem as que já entram como viagem, para não contar duas vezes"); aqui a implementação passa a bater com ela.
--
-- CORREÇÃO: mantém o guarda antigo (erp_viagem_lancamento.pagar_id, compatível com dado histórico) e acrescenta
--   a exclusão pelo vínculo real (erp_viagem_ge_titulo.pagar_id). Só leitura; mesma assinatura, mesma guarda por
--   empresa, mesmos grants. Sem consumidor no app hoje (conferido: nenhum .rpc em src/), então é seguro recriar.
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
                      AND NOT EXISTS (SELECT 1 FROM public.erp_viagem_lancamento v WHERE v.pagar_id = p.id AND v.excluido_em IS NULL)
                      AND NOT EXISTS (SELECT 1 FROM public.erp_viagem_ge_titulo t WHERE t.pagar_id = p.id)), 0)::numeric(14,2),
         COALESCE((SELECT sum(v.valor) FROM public.erp_viagem_lancamento v
                    WHERE v.obra_id = o.id AND v.excluido_em IS NULL), 0)::numeric(14,2)
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT public.get_user_company_ids());
$function$;

REVOKE ALL ON FUNCTION public.fn_obras_custo(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_custo(uuid[]) TO authenticated, service_role;
