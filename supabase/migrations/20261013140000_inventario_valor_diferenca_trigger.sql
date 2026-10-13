-- BUG Inventário (Eng. Chefe 13/10): valor_diferenca sempre 0. O trigger BEFORE lia NEW.diferenca, que é coluna
-- GENERATED (NULL em BEFORE). Passa a calcular das colunas-base. Contagem nula = 0.
CREATE OR REPLACE FUNCTION public.calc_valor_diferenca()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.valor_diferenca := COALESCE(NEW.quantidade_contada - NEW.quantidade_sistema, 0) * COALESCE(NEW.custo_unitario, 0);
  RETURN NEW;
END; $function$;

-- Backfill (em andamento + fechados): só o campo de valor e o total do cabeçalho; movimentações já geradas não são tocadas.
UPDATE public.erp_inventario_itens it
   SET valor_diferenca = COALESCE(it.quantidade_contada - it.quantidade_sistema, 0) * COALESCE(it.custo_unitario, 0)
  FROM public.erp_inventarios inv
 WHERE inv.id = it.inventario_id
   AND inv.status IN ('em_andamento', 'fechado')
   AND it.valor_diferenca IS DISTINCT FROM COALESCE(it.quantidade_contada - it.quantidade_sistema, 0) * COALESCE(it.custo_unitario, 0);

UPDATE public.erp_inventarios inv
   SET valor_divergencia = sub.v
  FROM (SELECT inventario_id, COALESCE(SUM(valor_diferenca) FILTER (WHERE quantidade_contada IS NOT NULL), 0) AS v
          FROM public.erp_inventario_itens GROUP BY inventario_id) sub
 WHERE sub.inventario_id = inv.id
   AND inv.status IN ('em_andamento', 'fechado')
   AND inv.valor_divergencia IS DISTINCT FROM sub.v;
