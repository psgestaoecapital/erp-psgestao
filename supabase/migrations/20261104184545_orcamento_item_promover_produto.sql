-- ONDA 1 (HUB) · Item de composição unificado — slice 3 (promover item manual a produto).
-- Aprovado pelo CEO 03/11. Code: desenvolvedor_4_g.
--
-- CONTEXTO (RD-38, produção): hoje 1.684 itens de orçamento são MANUAIS (produto_id IS NULL,
-- tipo_item='produto') contra apenas 252 de catálogo. O item manual é o fluxo dominante e não
-- tem estrutura de produto (sem custo do estoque, sem flutuação, sem reaproveitamento).
--
-- OBJETIVO DESTE SLICE: dar ao usuário o botão "promover a produto" — transformar um item
-- digitado à mão (ORIGEM MANUAL) em um produto real do catálogo (erp_produtos) e vincular o
-- item a ele (passa a ser ORIGEM CATÁLOGO, produto_id NOT NULL). A partir daí o item ganha
-- custo do estoque e o aviso de flutuação do slice 1/2.
--
-- SEGURANÇA / RD-26 (reusar, não recriar):
--   • Reaproveita a guarda fn_orcamento_item_guarda (acesso por empresa via get_user_company_ids
--     /is_admin + regra de "aberto e não congelado"). O produto nasce na MESMA empresa do item.
--   • SECURITY DEFINER com search_path fixo; REVOKE anon e GRANT apenas authenticated (gate
--     check-fn-guards). Nenhuma policy nova; erp_produtos e erp_orcamentos_itens já têm RLS por
--     company_id. Aditiva: CREATE OR REPLACE de função NOVA, não altera função nem dado existente
--     em massa (só o item que o usuário escolhe promover, dentro do escopo da guarda).
--   • origem (ICMS, fiscal) fica no default '0'; tipo='produto'; ativo=true; código único
--     MAN-xxxxxx por empresa (respeita ux_erp_produtos_company_codigo).
-- ci-sem-guarda: fn_orcamento_item_promover_produto — reusa fn_orcamento_item_guarda, que confere a empresa via get_user_company_ids()/is_admin() e devolve company_id
--
-- PROVA (RD-38, produção, BEGIN/ROLLBACK, statement_timeout 15s): sobre o item manual real
-- 2a67d1e9-… (Chapa de gesso ST 12,5mm, empresa …0006): INSERT em erp_produtos + UPDATE do
-- produto_id do item rodaram sem violar constraint; produto criado com código único; rollback
-- limpo. Idempotência natural: reexecutar sobre um item já promovido devolve erro amigável
-- (produto_id já preenchido), sem duplicar.

CREATE OR REPLACE FUNCTION public.fn_orcamento_item_promover_produto(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item      erp_orcamentos_itens;
  g           jsonb;
  v_company   uuid;
  v_codigo    text;
  v_produto_id uuid;
  v_tentativas int := 0;
BEGIN
  SELECT * INTO v_item FROM erp_orcamentos_itens WHERE id = p_item_id;
  IF v_item.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Item não encontrado.');
  END IF;

  -- Guarda do orçamento: acesso por empresa + orçamento aberto e não congelado.
  g := fn_orcamento_item_guarda(v_item.orcamento_id);
  IF NOT COALESCE((g->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', g->>'erro');
  END IF;
  v_company := (g->>'company_id')::uuid;

  IF v_item.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Item excluído não pode ser promovido.');
  END IF;
  IF v_item.produto_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false,
      'erro', 'Este item já vem do catálogo (produto vinculado).',
      'produto_id', v_item.produto_id);
  END IF;
  IF COALESCE(btrim(v_item.produto_nome), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Dê um nome ao item antes de promovê-lo a produto.');
  END IF;

  -- Código único por empresa (MAN-xxxxxx).
  LOOP
    v_codigo := 'MAN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM erp_produtos WHERE company_id = v_company AND codigo = v_codigo
    );
    v_tentativas := v_tentativas + 1;
    IF v_tentativas > 20 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Não foi possível gerar um código de produto. Tente novamente.');
    END IF;
  END LOOP;

  INSERT INTO erp_produtos (
    company_id, codigo, nome, descricao, unidade, tipo, preco_custo, preco_venda, ativo
  ) VALUES (
    v_company,
    v_codigo,
    btrim(v_item.produto_nome),
    NULLIF(btrim(COALESCE(v_item.produto_descricao, '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(v_item.unidade, '')), ''), 'UN'),
    'produto',
    COALESCE(v_item.preco_custo, 0),
    COALESCE(v_item.preco_unitario, 0),
    true
  ) RETURNING id INTO v_produto_id;

  -- Vincula o item ao novo produto: passa a ser item de catálogo.
  UPDATE erp_orcamentos_itens
  SET produto_id     = v_produto_id,
      produto_codigo = v_codigo,
      updated_at     = now()
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'ok', true,
    'produto_id', v_produto_id,
    'codigo', v_codigo,
    'item_id', p_item_id,
    'nome', btrim(v_item.produto_nome)
  );
END;
$function$;

-- Segurança: função como usuário autenticado; nunca anon/public (Pilar 2 / RD-52).
REVOKE ALL ON FUNCTION public.fn_orcamento_item_promover_produto(uuid) FROM public;
REVOKE ALL ON FUNCTION public.fn_orcamento_item_promover_produto(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_item_promover_produto(uuid) TO authenticated;

COMMENT ON FUNCTION public.fn_orcamento_item_promover_produto(uuid) IS
  'Onda 1 Hub slice 3: promove um item manual de orçamento (produto_id NULL) a produto do catálogo (erp_produtos) e vincula o item. Guarda por empresa via fn_orcamento_item_guarda. Code: desenvolvedor_4_g.';
