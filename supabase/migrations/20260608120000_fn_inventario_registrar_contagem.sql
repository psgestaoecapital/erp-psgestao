-- =============================================================
-- FIX-INVENTARIO-CONTAGEM-PERSIST-v1 · Saneamento V1 Fase 1
-- =============================================================
-- Bug: UPDATE direto do front em erp_inventario_itens incluia
-- 'diferenca' (GENERATED column · COALESCE(contada,0) - COALESCE(sistema,0))
-- · PostgREST rejeita · contagem nao persistia · "Fechar" nunca habilitava.
--
-- Plus: como diferenca e generated, item NAO contado ja vinha com
-- diferenca = 0 - sistema = -13 (OLEO). Front mostrava "1 divergencia"
-- sem nada contado. Divergencia real so existe pra item com contagem.
--
-- Fix: RPC SECURITY DEFINER que so seta colunas mutaveis + recalcula totais
-- do pai. Front passa a chamar a RPC no blur/Enter + filtra divergencia por
-- (quantidade_contada IS NOT NULL AND diferenca <> 0).
--
-- fechar_inventario continua usando 'ajuste' assinado (Compativel com PR #269).
-- Migration aplicada via MCP em 2026-06-08.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_inventario_registrar_contagem(
  p_item_id uuid,
  p_quantidade_contada numeric,
  p_usuario varchar DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id uuid;
BEGIN
  IF p_quantidade_contada IS NULL OR p_quantidade_contada < 0 THEN
    RAISE EXCEPTION 'Quantidade contada invalida: %', p_quantidade_contada;
  END IF;

  -- 1) Atualiza apenas colunas mutaveis · diferenca e GENERATED (auto)
  UPDATE public.erp_inventario_itens
     SET quantidade_contada = p_quantidade_contada,
         contado_em = now(),
         contado_por = p_usuario
   WHERE id = p_item_id
   RETURNING inventario_id INTO v_inv_id;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'Item de inventario nao encontrado: %', p_item_id;
  END IF;

  -- 2) Recalcula valor_diferenca explicit (trigger BEFORE ve generated stale)
  UPDATE public.erp_inventario_itens
     SET valor_diferenca = COALESCE(diferenca, 0) * COALESCE(custo_unitario, 0)
   WHERE id = p_item_id;

  -- 3) Recalcula totais do pai (so conta itens com quantidade_contada IS NOT NULL)
  UPDATE public.erp_inventarios i
     SET total_contados     = sub.total_contados,
         total_divergencias = sub.total_divergencias,
         valor_divergencia  = sub.valor_divergencia,
         updated_at         = now()
    FROM (
      SELECT inventario_id,
             COUNT(*) FILTER (WHERE quantidade_contada IS NOT NULL)::int AS total_contados,
             COUNT(*) FILTER (WHERE quantidade_contada IS NOT NULL AND COALESCE(diferenca,0) <> 0)::int AS total_divergencias,
             COALESCE(SUM(valor_diferenca) FILTER (WHERE quantidade_contada IS NOT NULL), 0) AS valor_divergencia
        FROM public.erp_inventario_itens
       WHERE inventario_id = v_inv_id
       GROUP BY inventario_id
    ) sub
   WHERE i.id = v_inv_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.fn_inventario_registrar_contagem(uuid, numeric, varchar) TO authenticated;
