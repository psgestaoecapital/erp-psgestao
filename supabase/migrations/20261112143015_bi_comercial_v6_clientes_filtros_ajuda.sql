-- RD-95: "?" para os 2 filtros da aba Clientes do painel v6
-- (seletor "Olhar por" da concentração/Pareto e a busca de cliente na tabela).
-- Aditiva e idempotente. Tabela de referência global de ajuda; NÃO altera dado de cliente,
-- NÃO mexe em RLS/grant/RPC. Reexecução não duplica (WHERE NOT EXISTS por chave).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT v.chave, v.rota, v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, v.vertical, v.ordem
FROM (VALUES
  ('com.painel.dimensao', '/dashboard/comercial/meu-painel-v6', 'Meu painel de vendas', 'Olhar por',
   'Seletor — escolha a dimensão da análise de concentração.',
   'Troca o eixo da curva de concentração (Pareto): ver quanto o faturamento depende de poucos CLIENTES, PRODUTOS, CIDADES ou VENDEDORES.',
   'Em "Cliente", a curva costuma mostrar que poucos clientes somam a maior parte do faturamento.',
   'Comparar a concentração de clientes com a de produtos sem trocar o seletor — são leituras diferentes.',
   'comercial', 34),
  ('com.painel.busca', '/dashboard/comercial/meu-painel-v6', 'Meu painel de vendas', 'Buscar cliente',
   'Digite parte do nome do cliente ou da cidade para filtrar a lista.',
   'Encontra rapidamente um cliente na tabela "Todos os clientes" sem precisar rolar tudo. Filtra por nome ou cidade.',
   'Digitar "mercado" mostra só os clientes cujo nome ou cidade contém "mercado".',
   'Esperar que a busca filtre os gráficos de cima — ela filtra apenas a tabela de clientes.',
   'comercial', 48)
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
