-- Produtividade · Apontamento hora a hora · /dashboard/produtividade/apontamento
-- RD-98 p3 (origem do dado): system_screens dessa rota estava com views_consumidas VAZIO. A tela lê as
--   tabelas prod_fluxo, prod_posto, prod_produto e industrial_plants e chama 2 funções. Esta migration
--   preenche a origem real.
--
-- Fontes conferidas no código (src/app/dashboard/produtividade/apontamento/page.tsx):
--   tabelas: industrial_plants (planta), prod_fluxo (fluxo), prod_posto (posto), prod_produto (produto)
--   funções: fn_prod_produtividade_hora (confronto do dia), fn_prod_apontar_hora (lançamento)
--
-- Idempotente (define os arrays exatos) e escopada só a esta rota. Metadado de tela — NÃO toca dado de
-- cliente, função, RLS nem regra fiscal/financeira. Faixa de segundos do desenvolvedor_4_g (:45).

UPDATE public.system_screens
SET views_consumidas = ARRAY['prod_fluxo','prod_posto','prod_produto','industrial_plants']::text[],
    rpcs_chamadas = ARRAY['fn_prod_produtividade_hora','fn_prod_apontar_hora']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/produtividade/apontamento';
