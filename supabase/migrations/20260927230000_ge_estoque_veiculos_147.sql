-- #147 (Alliance) · a GE mostra o estoque de veículos do pátio da Revenda.
--
-- O estoque da GE (Produtos/Saldo) não enxergava os carros: para a revenda, o carro É o estoque. Em vez de copiar
-- cada veículo para erp_produtos (dado duplicado que diverge), a GE lê o pátio — uma fonte só.
--
-- fn_veic_estoque_ge(company): veículos no ESTOQUE ATUAL (mesmas situações do pátio: em preparação, disponível,
-- reservado, consignado, devolvido — vendido/entregue já saíram), com
--   custo = aquisição + custos lançados (fn_veic_preco_minimo → custo.custo_total, o mesmo da ficha do carro),
--   preço anunciado, dias em estoque.
-- Consignado aparece, mas NÃO soma no valor do estoque: o carro não é da loja (#115).

CREATE OR REPLACE FUNCTION public.fn_veic_estoque_ge(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_itens jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  WITH base AS (
    SELECT v.id, v.marca, v.modelo, v.versao, v.placa, v.ano_modelo, v.situacao, v.origem, v.data_entrada,
           v.preco_venda,
           (v.origem = 'consignacao' OR v.situacao = 'consignado') AS consignado,
           NULLIF(public.fn_veic_preco_minimo(v.id)->'custo'->>'custo_total', '')::numeric AS custo
      FROM veic_veiculo v
     WHERE v.company_id = p_company_id
       AND v.deleted_at IS NULL
       AND COALESCE(v.ativo, true)
       AND v.situacao IN ('em_preparacao', 'disponivel', 'reservado', 'consignado', 'devolvido')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'marca', marca, 'modelo', modelo, 'versao', versao, 'placa', placa, 'ano_modelo', ano_modelo,
           'situacao', situacao, 'consignado', consignado,
           'custo', CASE WHEN consignado THEN NULL ELSE custo END,
           'preco_venda', preco_venda,
           'dias', CASE WHEN data_entrada IS NULL THEN NULL ELSE (current_date - data_entrada) END
         ) ORDER BY data_entrada NULLS LAST, modelo), '[]'::jsonb)
    INTO v_itens
    FROM base;

  RETURN jsonb_build_object(
    'ok', true,
    'tem_revenda', EXISTS (SELECT 1 FROM veic_veiculo WHERE company_id = p_company_id AND deleted_at IS NULL),
    'itens', v_itens,
    'totais', jsonb_build_object(
      'qtd', jsonb_array_length(v_itens),
      'qtd_proprios', (SELECT count(*) FROM jsonb_array_elements(v_itens) e WHERE NOT (e->>'consignado')::boolean),
      'qtd_consignados', (SELECT count(*) FROM jsonb_array_elements(v_itens) e WHERE (e->>'consignado')::boolean),
      'valor_custo', (SELECT COALESCE(round(sum((e->>'custo')::numeric), 2), 0) FROM jsonb_array_elements(v_itens) e
                       WHERE NOT (e->>'consignado')::boolean),
      'valor_anunciado', (SELECT COALESCE(round(sum((e->>'preco_venda')::numeric), 2), 0) FROM jsonb_array_elements(v_itens) e
                           WHERE NOT (e->>'consignado')::boolean),
      'sem_custo', (SELECT count(*) FROM jsonb_array_elements(v_itens) e
                     WHERE NOT (e->>'consignado')::boolean AND e->>'custo' IS NULL)
    ));
END $function$;

REVOKE ALL ON FUNCTION public.fn_veic_estoque_ge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_veic_estoque_ge(uuid) TO authenticated, service_role;
