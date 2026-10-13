-- OFICINA LOTE 6 · PEÇAS ESTRUTURADAS (peça do catálogo no laudo). Operacional — SEM baixa de estoque.
-- Hoje a peça no laudo é texto livre; erp_os_diagnostico_item.produto_id JÁ EXISTE mas a tela não
-- preenche. Este lote liga o catálogo: busca peça em v_erp_produtos_estoque → grava produto_id no item
-- (habilita preço automático via fn_oficina_preco_peca no orçamento) + mostra estoque como INFO.
-- 🚫 NÃO baixa estoque, NÃO gera título, NÃO abre tela financeira. Leitura + produto_id (aditivo).
-- RD-26 reusa v_erp_produtos_estoque. RD-45 escopo company_id. RD-46 não esconde produto sem categoria.

CREATE OR REPLACE FUNCTION public.fn_oficina_pecas_buscar(p_company_id uuid, p_termo text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'nome')), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id', v.id, 'codigo', v.codigo, 'nome', v.nome, 'marca', v.marca, 'unidade', v.unidade,
      'preco_venda', v.preco_venda, 'estoque_atual', v.estoque_atual, 'status_estoque', v.status_estoque) AS x
    FROM v_erp_produtos_estoque v
    WHERE v.company_id = p_company_id
      AND coalesce(v.ativo, true) = true
      AND coalesce(v.tipo, '') <> 'servico'                 -- peça é produto, não serviço
      AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
      AND (p_termo IS NULL OR btrim(p_termo) = ''
           OR v.nome ILIKE '%' || p_termo || '%'
           OR v.codigo ILIKE '%' || p_termo || '%'
           OR v.codigo_barras ILIKE '%' || p_termo || '%')
    ORDER BY v.nome
    LIMIT 20
  ) q;
$$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_pecas_buscar(uuid, text) TO authenticated;
