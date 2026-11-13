-- PDCA commerce/fichas (aud8 85→95). Tudo ADITIVO; nunca apaga dado de cliente.
-- Agente code-desenvolvedor-3 (faixa de segundos :35–:44).
--
-- GAP1 (RD-98 p4): exclusão RASTREÁVEL de ficha e de item (soft-delete via RPC guardada), no lugar do DELETE físico.
-- GAP2 (jornada): custo/preço calculados POR FICHA já na listagem (view v_ficha_resumo), sem abrir uma a uma.
-- GAP3 (RD-95): chaves de ajuda da tela.

-- 1) Colunas de soft-delete (idempotentes)
ALTER TABLE public.fichas_tecnicas ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.fichas_tecnicas ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.ficha_itens   ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.ficha_itens   ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) View de resumo: custo total e preço de venda por ficha (materiais ativos + mão de obra + indiretos% + impostos% + markup%).
--    Mesma fórmula do front (calcular()): custoTotal = (materiais+mo)·(1+ind/100)·(1+imp/100); preco = custoTotal·(1+markup/100).
--    security_invoker=on → respeita a RLS das tabelas de origem (empresa do usuário). Só fichas não excluídas.
CREATE OR REPLACE VIEW public.v_ficha_resumo
WITH (security_invoker = on) AS
SELECT
  f.*,
  COALESCE(agg.materiais, 0) AS materiais,
  ROUND(
    ((COALESCE(agg.materiais, 0) + COALESCE(f.mao_obra_direta, 0))
      * (1 + COALESCE(f.custos_indiretos_pct, 0) / 100.0)
      * (1 + COALESCE(f.impostos_pct, 0) / 100.0))::numeric
  , 2) AS custo_total,
  ROUND(
    (((COALESCE(agg.materiais, 0) + COALESCE(f.mao_obra_direta, 0))
      * (1 + COALESCE(f.custos_indiretos_pct, 0) / 100.0)
      * (1 + COALESCE(f.impostos_pct, 0) / 100.0))
      * (1 + COALESCE(f.markup_pct, 0) / 100.0))::numeric
  , 2) AS preco_venda
FROM public.fichas_tecnicas f
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(i.quantidade, 0) * COALESCE(i.preco_unitario, 0)) AS materiais
  FROM public.ficha_itens i
  WHERE i.ficha_id = f.id AND i.deleted_at IS NULL
) agg ON TRUE
WHERE f.deleted_at IS NULL;

REVOKE ALL ON public.v_ficha_resumo FROM PUBLIC, anon;
GRANT SELECT ON public.v_ficha_resumo TO authenticated, service_role;

-- 3) Exclusão rastreável da ficha (soft-delete + marca os itens; guarda de empresa; trilho no audit_log_global).
CREATE OR REPLACE FUNCTION public.fn_ficha_excluir(p_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.fichas_tecnicas WHERE id = p_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Ficha não encontrada ou já excluída.'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.fichas_tecnicas
     SET ativo = false, deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
   WHERE id = p_id;
  UPDATE public.ficha_itens
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE ficha_id = p_id AND deleted_at IS NULL;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_company, auth.uid(), 'fichas_tecnicas', p_id, 'EXCLUSAO_LOGICA',
          jsonb_build_object('ativo', true), jsonb_build_object('ativo', false, 'motivo', NULLIF(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ficha_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_excluir(uuid, text) TO authenticated, service_role;

-- 4) Exclusão rastreável de um item da ficha (soft-delete; guarda de empresa via ficha pai).
CREATE OR REPLACE FUNCTION public.fn_ficha_item_excluir(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT f.company_id INTO v_company
    FROM public.ficha_itens i
    JOIN public.fichas_tecnicas f ON f.id = i.ficha_id
   WHERE i.id = p_item_id AND i.deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Item não encontrado ou já excluído.'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.ficha_itens SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ficha_item_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_item_excluir(uuid) TO authenticated, service_role;

-- 5) RD-95: "?" de todos os campos/colunas/filtros/ações da tela de Fichas técnicas.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/commerce/fichas', 'gestao_empresarial', 'publicado'
FROM (VALUES
 -- Filtros
 ('commerce.fichas.filtro.busca', 'Fichas · Filtros', 'Buscar', 'Digite parte do nome, código ou descrição da ficha.', 'Encontra uma ficha específica sem rolar a lista inteira.', 'Parede drywall.', 'Buscar por um dado que não está no nome/código/descrição — a ficha não aparece.', 1),
 ('commerce.fichas.filtro.categoria', 'Fichas · Filtros', 'Categoria', 'Escolha uma categoria para ver só as fichas dela.', 'Separa as fichas por tipo de serviço/produto.', 'Alvenaria.', 'Esquecer o filtro ligado e achar que sumiram fichas de outras categorias.', 2),
 -- Colunas da listagem
 ('commerce.fichas.col.codigo', 'Fichas · Lista', 'Código', 'Coluna com o código interno da ficha.', 'Identifica a ficha de forma curta e única.', 'PAR-DRY-073.', 'Confundir duas fichas sem código (—).', 10),
 ('commerce.fichas.col.nome', 'Fichas · Lista', 'Nome', 'Coluna com o nome da ficha técnica.', 'É o nome comercial do serviço/produto composto.', 'Parede drywall dupla.', '—', 11),
 ('commerce.fichas.col.categoria', 'Fichas · Lista', 'Categoria', 'Coluna com a categoria da ficha.', 'Agrupa as fichas por tipo.', 'Vedação.', '—', 12),
 ('commerce.fichas.col.unidade', 'Fichas · Lista', 'Unid.', 'Coluna com a unidade de venda da ficha.', 'Define como o preço é medido (m², un, h).', 'm².', '—', 13),
 ('commerce.fichas.col.custo_total', 'Fichas · Lista', 'Custo total', 'Coluna (só leitura) do custo total calculado da ficha: materiais + mão de obra + indiretos + impostos.', 'Mostra quanto custa produzir a ficha, já na lista, sem abrir cada uma.', 'R$ 92,40.', 'Comparar custo sem conferir se os itens estão atualizados.', 14),
 ('commerce.fichas.col.preco_venda', 'Fichas · Lista', 'Preço venda', 'Coluna (só leitura) do preço de venda calculado: custo total mais o markup.', 'Mostra por quanto vender a ficha com a margem desejada, direto na lista.', 'R$ 120,12.', 'Usar o preço sem revisar o markup da ficha.', 15),
 -- Ações
 ('commerce.fichas.acao.nova', 'Fichas · Ações', 'Nova Ficha Técnica', 'Cria uma ficha técnica nova para a empresa selecionada.', 'Começa a montar a composição de custo de um serviço/produto.', 'Criar a ficha "Piso porcelanato 60x60".', 'Tentar criar sem escolher uma empresa específica no menu.', 20),
 -- Drawer · Identificação
 ('commerce.fichas.campo.codigo', 'Fichas · Identificação', 'Código', 'Um código curto e único para a ficha. Você escolhe o padrão.', 'Localiza a ficha rápido em listas e relatórios.', 'PAR-DRY-073.', 'Repetir um código já usado.', 30),
 ('commerce.fichas.campo.nome', 'Fichas · Identificação', 'Nome', 'O nome do serviço/produto que esta ficha compõe.', 'É o nome principal nas listas e propostas.', 'Parede drywall dupla.', 'Nome genérico que se confunde com outras fichas.', 31),
 ('commerce.fichas.campo.categoria', 'Fichas · Identificação', 'Categoria', 'A categoria a que a ficha pertence.', 'Organiza e filtra as fichas por tipo.', 'Vedação.', 'Deixar sem categoria e dificultar o filtro.', 32),
 ('commerce.fichas.campo.unidade', 'Fichas · Identificação', 'Unidade', 'A unidade em que a ficha é vendida/medida.', 'Define a base do custo e do preço (por m², un, h).', 'm².', 'Trocar a unidade depois de já ter orçado com outra.', 33),
 ('commerce.fichas.campo.descricao', 'Fichas · Identificação', 'Descrição', 'Detalhes do serviço/produto desta ficha.', 'Explica o que está incluso na composição.', 'Inclui montagem, massa e acabamento.', 'Repetir o nome em vez de detalhar.', 34),
 -- Drawer · Composição (itens)
 ('commerce.fichas.item.nome', 'Fichas · Composição', 'Item · Nome', 'O nome do material/insumo que entra na composição.', 'Lista o que é consumido para produzir a ficha.', 'Placa de gesso ST.', 'Nome vago que não deixa claro o insumo.', 40),
 ('commerce.fichas.item.unidade', 'Fichas · Composição', 'Item · Unid.', 'A unidade do item (un, m², kg, saco).', 'Garante que quantidade e preço estejam na mesma base.', 'un.', 'Misturar unidade de compra e de consumo.', 41),
 ('commerce.fichas.item.quantidade', 'Fichas · Composição', 'Item · Qtd', 'Quanto do item é usado por unidade da ficha.', 'Multiplica pelo preço para formar o custo de materiais.', '2 (placas por m²).', 'Informar a quantidade da obra inteira em vez de por unidade da ficha.', 42),
 ('commerce.fichas.item.preco_unitario', 'Fichas · Composição', 'Item · Preço un.', 'O preço de compra de uma unidade do item.', 'Base do subtotal do item (qtd × preço).', '18,90.', 'Lançar o preço do pacote em vez do unitário.', 43),
 ('commerce.fichas.item.subtotal', 'Fichas · Composição', 'Item · Subtotal', 'Valor do item (só leitura): quantidade × preço unitário.', 'Mostra quanto cada insumo pesa no custo de materiais.', '2 × 18,90 = 37,80.', '—', 44),
 ('commerce.fichas.item.excluir', 'Fichas · Composição', 'Remover item', 'Remove o item da composição da ficha (exclusão rastreável).', 'Tira um insumo lançado por engano; o custo recalcula sozinho.', 'Remover uma linha duplicada.', 'Remover o item certo achando que é a cópia — confira antes.', 45),
 -- Drawer · Custos & Markup
 ('commerce.fichas.campo.mao_obra', 'Fichas · Custos', 'Mão de obra direta (R$)', 'O custo de mão de obra por unidade da ficha.', 'Entra no custo base, antes de indiretos e impostos.', '35,00.', 'Somar aqui encargos que já estão nos indiretos.', 50),
 ('commerce.fichas.campo.indiretos_pct', 'Fichas · Custos', 'Custos indiretos (%)', 'Percentual de custos indiretos sobre o custo base (materiais + mão de obra).', 'Cobre despesas que não são do item (energia, administração).', '15 (para 15%).', 'Usar um percentual alto demais e inflar o preço.', 51),
 ('commerce.fichas.campo.impostos_pct', 'Fichas · Custos', 'Impostos (%)', 'Percentual de impostos sobre o custo base mais os indiretos.', 'Embute a carga tributária no custo da ficha.', '8,65 (para 8,65%).', 'Esquecer de ajustar ao regime tributário da empresa.', 52),
 ('commerce.fichas.campo.markup_pct', 'Fichas · Custos', 'Markup (%)', 'A margem que você adiciona sobre o custo total para formar o preço de venda.', 'Define o lucro desejado na venda da ficha.', '30 (para 30%).', 'Confundir markup (sobre o custo) com margem (sobre a venda).', 53),
 ('commerce.fichas.resumo.custo_total', 'Fichas · Custos', 'Custo total', 'Indicador (só leitura) do custo total: materiais + mão de obra + indiretos + impostos.', 'Mostra quanto custa produzir a ficha.', 'R$ 92,40.', '—', 54),
 ('commerce.fichas.resumo.preco_venda', 'Fichas · Custos', 'Preço de venda', 'Indicador (só leitura) do preço de venda: custo total + markup.', 'É o valor sugerido para vender a ficha com a margem definida.', 'R$ 120,12.', '—', 55),
 ('commerce.fichas.acao.excluir', 'Fichas · Ações', 'Excluir ficha', 'Exclui a ficha e seus itens de forma rastreável (soft-delete: fica o registro de quem e quando).', 'Tira da operação uma ficha que não se usa mais, sem perder o histórico.', 'Excluir uma ficha criada em duplicidade.', 'Excluir uma ficha em uso em propostas — confira antes.', 56)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
