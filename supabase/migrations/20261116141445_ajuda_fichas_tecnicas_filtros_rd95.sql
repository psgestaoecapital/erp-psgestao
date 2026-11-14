-- Commerce · Fichas Técnicas (/dashboard/commerce/fichas) — RD-95: "?" dos filtros da lista
-- ============================================================================
-- GAP (PDCA / anti-ócio GE): a tela de Fichas Técnicas do Comércio não tinha nenhum "?".
--   Primeira fatia (PR pequena): os dois controles do topo da lista — a busca e o filtro de
--   categoria. As demais ("?" dos campos do modal/detalhe) vêm em PRs seguintes.
-- CORREÇÃO (aditiva, idempotente): duas chaves em erp_ajuda_campo; o front renderiza
--   <AjudaCampo chave="..."> na busca e no seletor de categoria.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica; só mantém o texto atual.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.fichas.busca', '/dashboard/commerce/fichas', 'Fichas Técnicas', 'Buscar ficha',
   'Digite parte do nome, do código ou da descrição da ficha técnica que você procura.',
   'Filtra a lista em tempo real para achar a ficha sem rolar tudo — a busca olha nome, código e descrição.',
   'piso porcelanato', 'Se não achar, confira se a ficha é de outra empresa ou se o termo está escrito diferente do cadastro.', 'gestao_empresarial', 10),

  ('commerce.fichas.filtro_categoria', '/dashboard/commerce/fichas', 'Fichas Técnicas', 'Filtrar por categoria',
   'Escolha uma categoria para ver só as fichas daquele grupo (ou "Todas as categorias" para ver tudo).',
   'Restringe a lista a uma categoria, útil quando há muitas fichas de tipos diferentes.',
   'Revestimentos', 'O contador do canto ("X de Y") mostra quantas fichas sobraram no filtro — se vier 0, amplie para "Todas as categorias".', 'gestao_empresarial', 20)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
