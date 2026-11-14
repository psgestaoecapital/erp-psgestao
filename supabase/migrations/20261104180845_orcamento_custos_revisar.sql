-- ONDA 1 (HUB) · Item de composição unificado — slice 1 (camada de leitura).
-- Aprovado pelo CEO 03/11. Code: desenvolvedor_4_g.
--
-- OBJETIVO DESTE SLICE (aceite #2): dar a fonte de dados do aviso de FLUTUAÇÃO de custo.
-- Item de ORIGEM CATÁLOGO (vinculado a um produto do estoque, produto_id NOT NULL) tem o
-- custo gravado no momento da inclusão (erp_orcamentos_itens.preco_custo). Quando o custo do
-- estoque muda depois (nova compra), o orçamento AINDA ABERTO deve avisar "o custo do item X
-- subiu de R$ A para R$ B — atualizar?". Orçamento APROVADO/congelado congela o custo do
-- momento (rastreabilidade) e NÃO é revisável.
--
-- Esta função é SÓ LEITURA e ADITIVA: não altera nenhuma função nem nenhum dado existente.
-- Reutiliza (RD-26) a guarda fn_orcamento_item_guarda, que já encapsula o controle de acesso
-- por empresa (get_user_company_ids/is_admin) e a regra de "aberto e não congelado"
-- (status IN rascunho/revisao/enviado/visualizado, escopo_congelado_em IS NULL). Se a guarda
-- recusa (fechado/congelado/sem acesso), devolvemos revisavel=false sem erro: nada a revisar.
--
-- Custo atual do estoque = COALESCE(erp_produtos.preco_custo_medio, preco_custo, 0) — o custo
-- médio vindo das movimentações de estoque (flutua com a compra), com fallback para o custo
-- cadastrado. A comparação é por produto da MESMA empresa do item (company_id), e só considera
-- itens de catálogo (produto_id NOT NULL) não excluídos. Diferença < 1 centavo é ignorada.

CREATE OR REPLACE FUNCTION public.fn_orcamento_custos_revisar(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g      jsonb;
  v_company uuid;
  v_itens jsonb;
BEGIN
  g := fn_orcamento_item_guarda(p_orcamento_id);
  IF NOT COALESCE((g->>'ok')::boolean, false) THEN
    -- Fechado/congelado/sem acesso: custo congelado, nada a revisar (não é erro para a tela).
    RETURN jsonb_build_object(
      'ok', true,
      'revisavel', false,
      'motivo', g->>'erro',
      'itens', '[]'::jsonb,
      'qtd', 0
    );
  END IF;
  v_company := (g->>'company_id')::uuid;

  SELECT COALESCE(jsonb_agg(t.obj ORDER BY t.ordem), '[]'::jsonb)
  INTO v_itens
  FROM (
    SELECT
      i.ordem,
      jsonb_build_object(
        'item_id',          i.id,
        'produto_id',       i.produto_id,
        'produto_codigo',   i.produto_codigo,
        'produto_nome',     i.produto_nome,
        'unidade',          i.unidade,
        'quantidade',       i.quantidade,
        'custo_registrado', COALESCE(i.preco_custo, 0),
        'custo_atual',      round(COALESCE(p.preco_custo_medio, p.preco_custo, 0), 2),
        'variacao_valor',   round(COALESCE(p.preco_custo_medio, p.preco_custo, 0) - COALESCE(i.preco_custo, 0), 2),
        'variacao_pct',     CASE WHEN COALESCE(i.preco_custo, 0) > 0
                                 THEN round((COALESCE(p.preco_custo_medio, p.preco_custo, 0) - i.preco_custo) / i.preco_custo * 100, 2)
                                 ELSE NULL END,
        'subiu',            (COALESCE(p.preco_custo_medio, p.preco_custo, 0) > COALESCE(i.preco_custo, 0))
      ) AS obj
    FROM erp_orcamentos_itens i
    JOIN erp_produtos p
      ON p.id = i.produto_id
     AND p.company_id = i.company_id
    WHERE i.orcamento_id = p_orcamento_id
      AND i.company_id   = v_company
      AND i.produto_id IS NOT NULL      -- só itens de catálogo (vinculados a produto do estoque)
      AND i.excluido_em IS NULL
      AND round(abs(COALESCE(p.preco_custo_medio, p.preco_custo, 0) - COALESCE(i.preco_custo, 0)), 2) >= 0.01
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'revisavel', true,
    'itens', v_itens,
    'qtd', jsonb_array_length(v_itens)
  );
END;
$function$;

-- Segurança: função como usuário autenticado; nunca anon/public (Pilar 2 / RD-52).
REVOKE ALL ON FUNCTION public.fn_orcamento_custos_revisar(uuid) FROM public;
REVOKE ALL ON FUNCTION public.fn_orcamento_custos_revisar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_custos_revisar(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_orcamento_custos_revisar(uuid) IS
  'ONDA 1 Hub · itens de catálogo de um orçamento ABERTO cujo custo de estoque mudou desde a inclusão (fonte do aviso de flutuação). Só leitura; respeita acesso/congelamento via fn_orcamento_item_guarda.';
