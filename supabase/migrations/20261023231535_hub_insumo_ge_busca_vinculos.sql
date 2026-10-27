-- Hub · Insumos × estoque do GE integrado (RD-35): a tela precisa BUSCAR o produto do estoque, LISTAR os vínculos com o
-- custo vivo e DESVINCULAR. O vincular/custo já existem (20261016200005). Aditiva: 3 funções novas, guardadas por empresa,
-- sem tocar tabela existente. Leitura em lote (um JOIN, nada de função por linha).

-- Busca produtos do estoque nas empresas a que o usuário tem acesso (empresa de produto do grupo).
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_buscar_produtos(p_insumo_id uuid, p_busca text, p_limite int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid; v_q text := btrim(COALESCE(p_busca, '')); v_res jsonb;
BEGIN
  SELECT company_id INTO v_emp FROM m16_insumos WHERE id = p_insumo_id;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_emp);
  IF length(v_q) < 2 THEN RETURN jsonb_build_object('ok', true, 'produtos', '[]'::jsonb); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_res FROM (
    SELECT p.id, p.company_id, p.codigo, p.nome, p.unidade, p.estoque_atual,
           COALESCE(p.preco_custo_medio, p.preco_custo) AS custo_medio, p.preco_custo AS ultimo_custo
      FROM erp_produtos p
     WHERE p.ativo IS NOT FALSE
       AND (p.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
       AND (p.nome ILIKE '%' || v_q || '%' OR p.codigo ILIKE v_q || '%')
     ORDER BY p.nome
     LIMIT LEAST(GREATEST(COALESCE(p_limite, 20), 1), 50)
  ) t;
  RETURN jsonb_build_object('ok', true, 'produtos', v_res);
END $function$;

-- Vínculos ativos dos insumos de UMA empresa, com o custo vivo calculado como em fn_hub_insumo_custo.
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_vinculos(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_res FROM (
    SELECT v.insumo_id, v.produto_id, v.usar_maior_custo, p.codigo AS produto_codigo, p.nome AS produto_nome,
           p.estoque_atual AS saldo, p.unidade AS produto_unidade,
           CASE WHEN v.usar_maior_custo THEN GREATEST(COALESCE(p.preco_custo_medio, 0), COALESCE(p.preco_custo, 0))
                ELSE COALESCE(p.preco_custo_medio, p.preco_custo) END AS custo_estoque
      FROM hub_insumo_produto v
      JOIN erp_produtos p ON p.id = v.produto_id
     WHERE v.company_id = p_company_id AND v.ativo
       AND (p.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  ) t;
  RETURN jsonb_build_object('ok', true, 'vinculos', v_res);
END $function$;

-- Desfaz o vínculo (marca inativo; histórico preservado). O insumo volta a usar o custo do próprio catálogo.
CREATE OR REPLACE FUNCTION public.fn_hub_insumo_desvincular(p_insumo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid; v_n int;
BEGIN
  SELECT company_id INTO v_emp FROM m16_insumos WHERE id = p_insumo_id;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'insumo não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_emp);
  UPDATE hub_insumo_produto SET ativo = false, updated_at = now() WHERE insumo_id = p_insumo_id AND ativo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'desvinculados', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.fn_hub_insumo_buscar_produtos(uuid, text, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_vinculos(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_hub_insumo_desvincular(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_buscar_produtos(uuid, text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_vinculos(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_hub_insumo_desvincular(uuid) TO authenticated, service_role;

-- RD-95: "?" do novo modal e da coluna.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.insumos.estoque', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 28, 'Estoque (GE)',
   'Mostra o produto do estoque ligado ao insumo e o saldo. Use o botão de corrente para ligar ou trocar.', 'Ligado, o custo do insumo passa a ser o custo real do estoque e os serviços que o usam recalculam.',
   'Placa de gesso → produto 1042 do estoque, saldo 320', 'Cadastrar um insumo solto e esquecer de ligar ao estoque — o custo fica desatualizado.'),
  ('projetos.insumos.estoque_busca', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 29, 'Buscar produto do estoque',
   'Digite 2 letras ou mais do nome, ou o início do código do produto.', 'Só procura nos produtos do seu estoque; não altera nada até você escolher um.',
   'placa gesso', 'Procurar pelo nome do fornecedor — a busca é por nome ou código do produto.'),
  ('projetos.insumos.estoque_maior', '/dashboard/projetos/insumos', 'Insumos', 'hub_projetos', 30, 'Usar o maior custo',
   'Marque para usar o maior valor entre o custo médio e o da última compra.', 'Deixa o orçamento mais seguro quando o preço de reposição subiu.',
   'Médio R$ 38,00 e última compra R$ 44,00: usa R$ 44,00', 'Marcar sem querer e achar que o custo está inflado.')
ON CONFLICT (chave) DO NOTHING;
