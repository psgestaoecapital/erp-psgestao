-- Comércio · Fichas técnicas (/dashboard/commerce/fichas) — RD-95 "?" nas COLUNAS da lista (fatia 3)
-- ============================================================================
-- GAP (RD-95 · aud8 85/95): a fatia 1 (#5084) cobriu busca/filtro, a fatia 2 (#... detalhe) cobriu
--   os campos do painel. Faltava o "?" nas COLUNAS da LISTA de fichas — em especial as duas colunas
--   que são a razão-de-ser da tela: "Custo total" e "Preço venda" (valores CALCULADOS, não digitados).
-- CORREÇÃO (aditiva, idempotente): 2 chaves NOVAS para as colunas calculadas da lista. As colunas
--   Código/Nome/Categoria/Unidade reaproveitam as chaves já existentes do detalhe (mesmo significado).
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('commerce.fichas.col_custo_total', '/dashboard/commerce/fichas', 'Lista', 'Custo total',
   'Esta coluna NÃO é preenchida por você: o sistema calcula sozinho a partir da composição da ficha.',
   'Mostra, por ficha, o custo total de 1 unidade = materiais + mão de obra direta + custos indiretos + impostos. É a base sobre a qual o markup vira preço de venda.',
   'R$ 142,80', 'Se vier "—", a ficha ainda não teve a composição carregada; abra a ficha para calcular os itens.', 'gestao_empresarial', 140),

  ('commerce.fichas.col_preco_venda', '/dashboard/commerce/fichas', 'Lista', 'Preço venda',
   'Esta coluna NÃO é preenchida por você: o sistema calcula sozinho o preço de venda sugerido da ficha.',
   'Mostra o preço de venda por unidade = custo total + markup (%). É o número que você leva para orçamentos e pedidos.',
   'R$ 185,64', 'Preço baixo demais costuma ser markup zerado ou mão de obra/indiretos não lançados na ficha.', 'gestao_empresarial', 150)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
