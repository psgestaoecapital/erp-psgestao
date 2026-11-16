-- Cotações de Compra (/dashboard/cotacoes) — RD-95 "?"
-- ============================================================================
-- GAP (RD-95): a tela de Cotações de Compra tinha campos sem "?": o seletor de
--   empresa e a busca (lista) e, no modal "Nova Cotação", os itens a cotar
--   (produto/qtd/unidade) e a seleção de fornecedores a convidar.
-- CORREÇÃO (aditiva, idempotente): 4 chaves NOVAS no grupo "Cotações". O "?" é
--   renderizado por <AjudaCampo> (seletor, busca) e no título das seções (itens,
--   fornecedores), creditando os campos via data-ajuda.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('cotacoes.empresa', '/dashboard/cotacoes', 'Cotações', 'Empresa',
   'Escolha a empresa (CNPJ) cujas cotações você quer ver e na qual uma nova cotação será aberta.',
   'Filtra a lista de cotações e define em qual empresa a próxima cotação e o pedido de compra gerado serão lançados.',
   'Trocar para "Matriz Ltda" para cotar a compra dessa unidade.',
   'Abrir uma cotação na empresa errada gera o pedido de compra no CNPJ errado — confira a empresa antes de criar.',
   'geral', 9243),
  ('cotacoes.busca', '/dashboard/cotacoes', 'Cotações', 'Busca',
   'Digite parte do número ou da descrição da cotação para filtrar a lista.',
   'Acha rápido uma cotação específica sem rolar toda a lista.',
   'Buscar "mensal" ou o número "0012".',
   'A busca é só por número e descrição; para filtrar por situação use os botões de status ao lado.',
   'geral', 9244),
  ('cotacoes.nova.itens', '/dashboard/cotacoes', 'Cotações', 'Itens a cotar',
   'Para cada item, escolha o produto do cadastro, informe a quantidade e a unidade de compra.',
   'Define o que os fornecedores vão precificar; a quantidade e a unidade entram na comparação das propostas.',
   'Produto "Cimento CP-II", quantidade 50, unidade "SC".',
   'Deixar a quantidade zerada ou sem escolher o produto no cadastro deixa o item incompleto para o fornecedor cotar.',
   'geral', 9245),
  ('cotacoes.nova.fornecedores', '/dashboard/cotacoes', 'Cotações', 'Fornecedores a convidar',
   'Marque os fornecedores cadastrados que receberão o convite para enviar proposta desta cotação.',
   'Define quem será convidado a cotar; depois você compara as propostas lado a lado e aprova a melhor.',
   'Convidar 3 fornecedores de material de construção para comparar preço e prazo.',
   'Não marcar nenhum fornecedor cria a cotação sem ninguém para responder — selecione ao menos um.',
   'geral', 9246)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
