-- Painel Comercial v6 (storytelling) — bloco 7: aba "Preço e desconto" na rota /dashboard/comercial/meu-painel-v6.
-- Cadastra as chaves de ajuda "?" (RD-95) da aba. Aditiva e idempotente (ON CONFLICT DO NOTHING).
-- Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.aba_preco', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Preço e desconto', 'comercial', 50, 'publicado',
   'Navegação — não se preenche.',
   'Mostra quem vende mais caro ou mais barato e quanto de desconto cada cliente recebe sobre a tabela.',
   'Abra para cuidar da política de preço e desconto.',
   'Olhar preço sem olhar desconto: o preço final depende dos dois.'),
  ('comv6.pd_caro_barato', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Quem vende mais caro e mais barato', 'comercial', 51, 'publicado',
   'Indicador calculado — não se preenche.',
   'Preço médio (R$/kg da análise) por vendedor, comparado à média da empresa — ▲ acima, ▼ abaixo.',
   'Um vendedor sempre ▼ pode estar dando preço para fechar volume; vale conferir a margem.',
   'Cobrar preço alto de quem atende clientes pequenos sem olhar o mix que ele vende.'),
  ('comv6.pd_desc_cliente', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Desconto por cliente', 'comercial', 52, 'publicado',
   'Indicador calculado — não se preenche.',
   'O total de desconto dado sobre a tabela no período e os clientes que mais receberam desconto (em reais e em % da tabela).',
   'Um cliente com 8% de desconto e faturamento médio merece revisão de política de preço.',
   'Olhar o desconto em reais sem o percentual: um cliente grande com desconto baixo em % pode somar muito.')
ON CONFLICT (chave) DO NOTHING;
