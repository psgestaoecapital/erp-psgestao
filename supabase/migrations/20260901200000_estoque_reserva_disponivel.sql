-- Oficina/Estoque · Bloco D — reserva de estoque como ESTADO (não como lugar).
-- Decisão do CEO (01/09): a reserva NASCE quando a OS fica PRONTA, mas a regra é de ESTADO:
--   enquanto a OS estiver em 'pronta' OU 'entregue' E NÃO faturada, as peças dela estão RESERVADAS.
-- Ciclo: pronta→reservada · fatura→baixa (some da reserva) · cancela→some.
-- TRÊS NÚMEROS onde hoje existe um: físico (erp_produtos.estoque_atual) · reservado · disponível.
-- Só o DISPONÍVEL pode ser vendido. A reserva é ESTADO, não lugar: nada muda de local, o inventário
-- físico continua batendo com a prateleira (o CEO recusou um "local RESERVA" justamente por isso).
--
-- Fonte real das peças comprometidas: erp_os_diagnostico_item (tipo=peça, produto_id, quantidade).
-- erp_os_peca_solicitacao está morta (1 linha recusada) — NÃO é o gancho.
--
-- Reserva DERIVADA (não materializada): é estado, então é calculada da fonte, nunca uma coluna que
-- pode divergir (RD-52). Esta RPC é a fonte única do "reservado". Retorna só produtos COM reserva
-- (esparso: nasce quase vazio — 1 peça hoje — e cresce conforme A/A2 vinculam as texto-livre).

CREATE OR REPLACE FUNCTION public.fn_estoque_reservas(p_company_ids uuid[])
 RETURNS TABLE(produto_id uuid, reservado numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.produto_id,
         -- linha de peça com produto = pelo menos 1 unidade comprometida; qtd ausente conta como 1
         -- (piso conservador: sub-reservar reabriria exatamente o furo que o Bloco D fecha).
         SUM(COALESCE(NULLIF(d.quantidade, 0), 1))::numeric AS reservado
    FROM erp_os_diagnostico_item d
    JOIN erp_os o ON o.id = d.os_id
   WHERE d.company_id = ANY(p_company_ids)
     AND d.company_id IN (SELECT get_user_company_ids())   -- escopo do usuário (guarda multi-tenant)
     AND d.produto_id IS NOT NULL
     AND d.tipo IN ('peca','peça','produto')
     AND o.status IN ('pronta','entregue')                 -- estado que reserva
     AND NOT COALESCE(o.titulos_gerados, false)             -- e ainda não faturada (fatura = baixa)
   GROUP BY d.produto_id
  HAVING SUM(COALESCE(NULLIF(d.quantidade, 0), 1)) > 0;
$function$;

REVOKE ALL ON FUNCTION public.fn_estoque_reservas(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_estoque_reservas(uuid[]) TO authenticated, service_role;
