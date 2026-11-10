-- Painel Comercial v6 (storytelling) — bloco 5: aba "Cidades" na rota /dashboard/comercial/meu-painel-v6.
-- Duas seções derivadas de modelo.cidM + cidVen (o motor v5 já agrega por cidade) — front puro, sem RPC nova e sem
-- tocar o v5 em /meu-painel:
--   1. "Onde a Frioeste vende" — as cidades que mais pesam no faturamento, com clientes e vendedores de cada uma.
--   2. "Todas as cidades" — a tabela completa (cidade, faturamento, participação, clientes, vendedores).
--
-- A ajuda "?" é carregada por ROTA (fn_ajuda_campo_listar filtra c.rota = p_rota); as chaves são do v6 (comv6.*).
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.cid_onde', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Onde a Frioeste vende', 'comercial', 14, 'publicado',
   'Indicador calculado — não se preenche.',
   'As cidades que mais pesam no faturamento do período, com o valor, a participação, quantos clientes e quantos vendedores atuam em cada uma.',
   'Uma cidade grande atendida por um só vendedor é risco de concentração e também oportunidade de reforço.',
   'Confundir cidade com cliente: uma cidade pode ter muitos clientes e ainda assim poucos vendedores.'),
  ('comv6.cid_todas', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Todas as cidades', 'comercial', 15, 'publicado',
   'Indicador calculado — não se preenche.',
   'A tabela completa de cidades do período: faturamento, participação no total, número de clientes e número de vendedores que atuam na cidade.',
   'Ordenar por faturamento mostra onde está o dinheiro; olhar vendedores mostra onde a cobertura é fina.',
   'Somar as participações e estranhar passar de 100%: cada venda entra na cidade do cliente, sem dupla contagem.')
ON CONFLICT (chave) DO NOTHING;
