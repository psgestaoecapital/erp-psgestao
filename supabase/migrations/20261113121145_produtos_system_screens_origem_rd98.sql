-- Produtos (Indústria) · /dashboard/produtividade/produtos
-- RD-98 p3 (origem do dado): o auditor (aud8 run 1935) apontou que system_screens dessa rota estava com
--   views_consumidas VAZIO e rpcs_chamadas incompleto (só fn_prod_produto_colar). A tela, de fato, lê as
--   tabelas prod_produto e industrial_plants e chama 5 funções. Esta migration preenche a origem real.
--
-- Fontes conferidas no código (src/app/dashboard/produtividade/produtos/page.tsx):
--   tabelas: prod_produto (lista), industrial_plants (seletor de planta)
--   funções: fn_prod_produto_f1_salvar, fn_prod_produto_arquivar, fn_prod_estrutura_listar,
--            fn_prod_produto_colar, fn_prod_atak_produtos
--
-- Idempotente (define os arrays exatos) e escopada só a esta rota. Metadado de tela — NÃO toca dado de
-- cliente, função, RLS nem regra fiscal/financeira. Faixa de segundos do desenvolvedor_4_g (:45).

UPDATE public.system_screens
SET views_consumidas = ARRAY['prod_produto','industrial_plants']::text[],
    rpcs_chamadas = ARRAY['fn_prod_produto_f1_salvar','fn_prod_produto_arquivar','fn_prod_estrutura_listar','fn_prod_produto_colar','fn_prod_atak_produtos']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/produtividade/produtos';
