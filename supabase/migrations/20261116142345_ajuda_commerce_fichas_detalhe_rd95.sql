-- Comércio · Fichas técnicas (/dashboard/commerce/fichas) — RD-95 "?" no painel de detalhe (fatia 2)
-- ============================================================================
-- GAP (RD-95): a fatia 1 (#5084) cobriu busca e filtro de categoria. O painel lateral de detalhe
--   da ficha (Identificação + Custos & Markup) tinha os campos SEM "?": Código, Nome, Categoria,
--   Unidade, Descrição, Mão de obra direta, Custos indiretos %, Impostos %, Markup %.
-- CORREÇÃO (aditiva, idempotente): 9 chaves em erp_ajuda_campo; o componente Field renderiza
--   <AjudaCampo> no rótulo de cada campo quando recebe a prop `ajuda`.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.fichas.codigo', '/dashboard/commerce/fichas', 'Identificação', 'Código',
   'Um código curto e único que você usa para achar essa ficha rápido (opcional).',
   'Serve para localizar e referenciar a ficha em orçamentos e pedidos sem depender do nome inteiro.',
   'PAR-DRY-073', 'Repetir o mesmo código em duas fichas dificulta achar a certa depois.', 'gestao_empresarial', 10),

  ('commerce.fichas.nome', '/dashboard/commerce/fichas', 'Identificação', 'Nome',
   'O nome do produto ou serviço desta ficha, do jeito que a sua equipe reconhece.',
   'É o título que aparece nas listas, orçamentos e no cálculo do preço de venda.',
   'Parede Drywall Simples 73mm (ST)', 'Nome genérico demais ("Serviço 1") faz você perder tempo procurando depois.', 'gestao_empresarial', 20),

  ('commerce.fichas.categoria', '/dashboard/commerce/fichas', 'Identificação', 'Categoria',
   'A família a que o produto/serviço pertence (escolha na lista).',
   'Agrupa fichas parecidas e permite filtrar a lista por categoria.',
   'Alvenaria / Acabamento', 'Deixar sem categoria tira a ficha dos filtros e dificulta a organização.', 'gestao_empresarial', 30),

  ('commerce.fichas.unidade', '/dashboard/commerce/fichas', 'Identificação', 'Unidade',
   'A unidade em que você vende este item (escolha na lista): m², un, kg, hora etc.',
   'Define a base do preço de venda — o custo e o markup são calculados por esta unidade.',
   'm²', 'Usar a unidade errada (ex.: "un" quando vende por m²) distorce o preço final.', 'gestao_empresarial', 40),

  ('commerce.fichas.descricao', '/dashboard/commerce/fichas', 'Identificação', 'Descrição',
   'Um texto livre com detalhes do que está incluso, especificação ou observações (opcional).',
   'Ajuda quem monta o orçamento a entender o escopo sem abrir a composição item a item.',
   'Inclui montante, guias, placas ST e parafusos; não inclui pintura.', '—', 'gestao_empresarial', 50),

  ('commerce.fichas.mao_obra_direta', '/dashboard/commerce/fichas', 'Custos & Markup', 'Mão de obra direta (R$)',
   'Quanto de mão de obra entra em UMA unidade deste item, em reais.',
   'Soma ao custo dos materiais para formar o custo total antes dos indiretos e do markup.',
   '35,00', 'Lançar a mão de obra do serviço inteiro (e não de 1 unidade) infla o custo.', 'gestao_empresarial', 60),

  ('commerce.fichas.custos_indiretos_pct', '/dashboard/commerce/fichas', 'Custos & Markup', 'Custos indiretos (%)',
   'O percentual de custos indiretos (estrutura, administração) que incide sobre o custo direto.',
   'Acrescenta ao custo a parcela que não aparece nos materiais nem na mão de obra direta.',
   '10', 'Confundir com o markup: indiretos são CUSTO; markup é a margem sobre o custo.', 'gestao_empresarial', 70),

  ('commerce.fichas.impostos_pct', '/dashboard/commerce/fichas', 'Custos & Markup', 'Impostos (%)',
   'O percentual de impostos que você quer embutir no preço de venda.',
   'Entra no cálculo para que o preço final já cubra a carga tributária da venda.',
   '6', 'Deixar zero quando há imposto na venda faz o preço sair abaixo do necessário.', 'gestao_empresarial', 80),

  ('commerce.fichas.markup_pct', '/dashboard/commerce/fichas', 'Custos & Markup', 'Markup (%)',
   'A margem que você quer aplicar SOBRE o custo total para chegar ao preço de venda.',
   'É o que define o lucro do item: preço de venda = custo total + markup (e impostos).',
   '30', 'Markup não é a mesma coisa que margem sobre a venda — 30% de markup dá menos de 30% de margem.', 'gestao_empresarial', 90),

  -- Composição (BOM): colunas da tabela de itens/materiais da ficha
  ('commerce.fichas.item_nome', '/dashboard/commerce/fichas', 'Composição', 'Item · Nome',
   'O nome do material ou insumo que compõe esta ficha.',
   'Identifica cada item que entra no custo; a soma dos itens forma o custo de materiais.',
   'Placa de gesso ST 12,5mm', 'Nome vago ("material 1") dificulta revisar a composição depois.', 'gestao_empresarial', 100),

  ('commerce.fichas.item_unidade', '/dashboard/commerce/fichas', 'Composição', 'Item · Unidade',
   'A unidade de compra/consumo do item (un, m², kg, saco etc.).',
   'Garante que quantidade e preço unitário estejam na mesma base para o subtotal bater.',
   'm²', 'Misturar unidade do item com a unidade de venda da ficha distorce o custo.', 'gestao_empresarial', 110),

  ('commerce.fichas.item_qtd', '/dashboard/commerce/fichas', 'Composição', 'Item · Quantidade',
   'Quanto deste item é consumido para produzir UMA unidade da ficha.',
   'Multiplica pelo preço unitário para gerar o subtotal do item no custo de materiais.',
   '2,1', 'Informar a quantidade do lote inteiro (e não por unidade da ficha) infla o custo.', 'gestao_empresarial', 120),

  ('commerce.fichas.item_preco', '/dashboard/commerce/fichas', 'Composição', 'Item · Preço unitário',
   'O preço de compra de UMA unidade do item, em reais.',
   'Base do subtotal (quantidade × preço) e, somado aos demais, do custo de materiais.',
   '18,90', 'Usar preço com imposto quando o resto é sem imposto (ou vice-versa) descasa o custo.', 'gestao_empresarial', 130)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
