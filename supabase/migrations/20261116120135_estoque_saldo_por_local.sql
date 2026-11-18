-- Estoque · Saldo POR LOCAL/DEPÓSITO (PDCA GE /dashboard/commerce/estoque, gap 4)
--
-- Problema (auditor_pdca_2 13/11, reaudit aud8 14/11 nota 92): a aba "Saldo" joga
-- todo o estoque no local principal. fn_curva_abc_estoque (fonte de saldo da aba)
-- é por PRODUTO, não por local → multi-depósito não reflete o saldo real por depósito.
--
-- Fix ADITIVO: função NOVA de leitura que reconstrói o saldo por (produto, local) a
-- partir de erp_estoque_movimentacoes. Sinal pelo `tipo`:
--   entrada, ajuste_positivo        => +quantidade
--   saida, venda, ajuste_negativo   => -quantidade
-- (RD-38: conferido no dado — 2907/2922 produtos reconciliam EXATAMENTE com
--  erp_produtos.estoque_atual somando os movimentos por este sinal.)
--
-- Só agrega movimentos COM local_id. A UI usa erp_produtos.estoque_atual como fonte
-- da verdade do total e distribui o restante (não localizado) no local principal, de
-- modo que o total por produto nunca contradiz o saldo oficial.
--
-- Guarda multi-tenant: SECURITY DEFINER + company_id IN (SELECT get_user_company_ids())
-- (mesmo padrão de fn_estoque_reservas). Leitura pura, sem escrever dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_estoque_saldo_por_local(p_company_ids uuid[])
RETURNS TABLE(produto_id uuid, local_id uuid, saldo numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    m.produto_id,
    m.local_id,
    SUM(
      CASE
        WHEN m.tipo IN ('entrada', 'ajuste_positivo') THEN m.quantidade
        WHEN m.tipo IN ('saida', 'venda', 'ajuste_negativo') THEN -m.quantidade
        ELSE 0
      END
    )::numeric AS saldo
  FROM erp_estoque_movimentacoes m
  WHERE m.company_id = ANY(p_company_ids)
    AND m.company_id IN (SELECT get_user_company_ids())   -- escopo do usuário (guarda multi-tenant)
    AND m.local_id IS NOT NULL
    AND m.produto_id IS NOT NULL
  GROUP BY m.produto_id, m.local_id;
$function$;

REVOKE ALL ON FUNCTION public.fn_estoque_saldo_por_local(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_estoque_saldo_por_local(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_estoque_saldo_por_local(uuid[]) IS
  'Saldo de estoque por (produto, local) reconstruído dos movimentos (sinal pelo tipo). Leitura, guarda multi-tenant. PDCA GE estoque gap 4 (saldo por depósito).';
