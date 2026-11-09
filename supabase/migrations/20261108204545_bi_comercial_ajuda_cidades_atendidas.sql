-- BI Comercial · Visão geral — indicador "Cidades atendidas".
-- A RPC fn_bi_comercial_kpis JÁ devolve o campo `cidades` (COUNT DISTINCT da cidade normalizada, sem acento/caixa),
-- mas a aba Visão geral não exibia o indicador (era placeholder honesto). Esta migration só cadastra o texto de
-- ajuda RD-95 do novo indicador; a leitura do número é front, reusando o dado que a RPC já calcula (RD-26).
--
-- RD-38 (produção, só leitura): company ATAK 975365cc-9e5a-4251-9022-68c6bfde10d8 → 87 cidades normalizadas
-- em bi_comercial_item_mv (mesmo valor que o COUNT DISTINCT da RPC e que a leitura automática da aba Cidades).
--
-- ADITIVA e idempotente (WHERE NOT EXISTS por rota+chave), catálogo de ajuda GLOBAL, sem dado de cliente, sem
-- alterar nenhuma linha existente. Não cria/altera tabela, função, RLS ou grant. RD-52: arquivo + PR, versão
-- 20261108204545 acima da última da main (20261108190045), faixa de segundos :45–:54.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  (
    'comercial.bi.cidades_atendidas',
    '/dashboard/inteligencia/comercial',
    'Visão geral',
    'Cidades atendidas',
    'Indicador automático: não se preenche. Mostra quantas cidades diferentes compraram no período filtrado.',
    'Mede o alcance geográfico da operação comercial. As cidades são contadas sem acento e sem diferença de maiúsculas/minúsculas, para que "Nova Erechim" e "NOVA ERECHIM" contem como uma só. Abra a aba Cidades para ver o detalhe de cada praça (clientes e produtos).',
    'No período, 87 cidades atendidas significa que houve venda para clientes de 87 municípios distintos.',
    'Confundir com o número de clientes: uma cidade pode ter vários clientes, e um cliente compra de uma cidade só — por isso os dois indicadores raramente batem.',
    'comercial',
    35,
    'publicado'
  )
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave
);
