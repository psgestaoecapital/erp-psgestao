-- Ficha Técnica de Produção (/dashboard/ficha-tecnica) — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): a tela de Ficha Técnica (composição de custo por m²) não tinha
--   nenhum "?": seletor de empresa, formulário Nova Ficha, busca de produto, os
--   4 campos de custo (MO direta, indiretos %, impostos %, markup %) e as colunas
--   editáveis da tabela de materiais (código, material, un, qtd/m², preço un.).
-- CORREÇÃO (aditiva, idempotente): 12 chaves NOVAS no grupo "Ficha Técnica". O "?"
--   é renderizado por <AjudaCampo> (seletor, rótulos, seções e colunas da tabela).
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo (custo/markup/preço), RLS nem dado de cliente: só texto de ajuda
-- num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ficha.empresa', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Empresa',
   'Escolha a empresa (ou o grupo/consolidado) cujas fichas técnicas você quer ver e editar.',
   'Cada empresa tem seu próprio catálogo de fichas e produtos; o seletor define onde a ficha é salva.',
   'Trocar para "Matriz" para ver as fichas daquela unidade.',
   'Editar a ficha na empresa errada salva a composição no catálogo errado — confira a empresa no topo.',
   'geral', 9230),
  ('ficha.nova', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Nova ficha',
   'Dê um nome descritivo à tipologia, escolha a categoria e informe a mão de obra (R$/m²) e os indiretos (%) iniciais.',
   'Cria uma ficha em branco para você montar a composição de materiais e os custos por m².',
   'Nome "Parede Drywall Simples 73mm", categoria "parede", MO 35, indiretos 10.',
   'Criar sem nome dificulta achar a ficha depois; MO e indiretos podem ser ajustados a qualquer momento no topo da ficha.',
   'geral', 9231),
  ('ficha.produto_busca', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Buscar produto',
   'Digite o nome ou o código de um produto do seu estoque para trazê-lo com preço para a ficha.',
   'Adiciona materiais já cadastrados com o preço atual, sem digitar tudo à mão.',
   'Buscar "placa ST" e clicar no produto para incluí-lo na ficha.',
   'Sem produtos cadastrados a busca fica vazia — sincronize o estoque em Dados ou adicione o material manualmente na última linha da tabela.',
   'geral', 9232),
  ('ficha.mao_obra_direta', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'MO Direta (R$/m²)',
   'Custo de mão de obra direta para produzir/instalar 1 m² desta tipologia, em reais.',
   'Entra no custo total por m² somado a material, indiretos e impostos.',
   'R$ 35,00/m² para parede simples.',
   'Informar o valor total da obra no lugar do valor por m² infla o custo — use sempre por m².',
   'geral', 9233),
  ('ficha.custos_indiretos_pct', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Custos Indiretos (%)',
   'Percentual de custos indiretos (administração, ferramentas, perdas) sobre o custo direto.',
   'Acrescenta a parcela de indiretos ao custo por m² antes dos impostos e do markup.',
   '10 (para 10%).',
   'Digitar 0,10 em vez de 10 aplica só 0,1% — informe o percentual cheio.',
   'geral', 9234),
  ('ficha.impostos_pct', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Impostos (%)',
   'Percentual de impostos sobre a venda considerado na formação do preço.',
   'Soma a parcela de impostos ao custo por m² antes de aplicar o markup.',
   '6 (Simples) ou o percentual do seu regime.',
   'Confunda alíquota de compra com a de venda e o preço sai distorcido — use a de venda do seu regime.',
   'geral', 9235),
  ('ficha.markup_pct', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Markup (%)',
   'Margem aplicada sobre o custo total por m² para chegar ao preço de venda.',
   'Define o preço de venda/m² (custo × markup) e, com ele, o lucro por m² exibido nos indicadores.',
   '30 (para 30% de margem).',
   'Markup muito baixo pode zerar ou negativar o lucro/m² — confira o indicador de Lucro ao ajustar.',
   'geral', 9236),
  ('ficha.item_codigo', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Código do material',
   'Código do material no seu cadastro (opcional); preenche sozinho quando o item vem da busca de produto.',
   'Liga o item ao cadastro de estoque para atualização de preço e rastreio.',
   'MAT-0012 ou o código do seu ERP.',
   'Deixar em branco não impede salvar, mas dificulta atualizar o preço pelo estoque depois.',
   'geral', 9237),
  ('ficha.item_material', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Material / insumo',
   'Nome do material ou insumo que compõe 1 m² desta tipologia.',
   'Identifica a linha da composição; junto com qtd e preço forma o custo de material por m².',
   'Placa ST 1200x2400x12,5mm.',
   'Nome genérico demais atrapalha conferir a composição — descreva o material como no cadastro.',
   'geral', 9238),
  ('ficha.item_unidade', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Unidade',
   'Unidade de medida do material (un, m, m², kg, L, rolo, saco, caixa...).',
   'Deixa claro a que se refere a quantidade por m² e o preço unitário.',
   '"un" para parafuso, "m" para montante.',
   'Misturar a unidade da quantidade com a do preço gera custo errado — use a mesma base nos dois.',
   'geral', 9239),
  ('ficha.item_qtd', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Qtd por m²',
   'Quantidade do material consumida por m² da tipologia, na unidade informada.',
   'Multiplica pelo preço unitário para formar o custo do material por m².',
   '2,10 placas/m²; 24 parafusos/m².',
   'Informar a quantidade da obra inteira em vez de por m² distorce todo o custo — use sempre por m².',
   'geral', 9240),
  ('ficha.item_preco', '/dashboard/ficha-tecnica', 'Ficha Técnica', 'Preço unitário',
   'Preço de compra de uma unidade do material; vem automático quando o item sai da busca de produto.',
   'Multiplica pela quantidade por m² para compor o custo de material da ficha.',
   'R$ 28,50 por placa.',
   'Usar o preço total do pacote no lugar do unitário multiplica o custo — informe o preço de uma unidade.',
   'geral', 9241)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
