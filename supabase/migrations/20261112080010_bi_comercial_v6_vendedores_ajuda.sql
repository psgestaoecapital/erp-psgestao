-- Painel Comercial v6 (storytelling) — bloco 3: aba "Vendedores" na rota /dashboard/comercial/meu-painel-v6.
-- Três seções novas (storytelling), todas lendo a MESMA base do motor v5 (modelo.venM + modelo.devVen), sem tocar
-- o v5 em /meu-painel:
--   1. "Quem vende quanto" — ranking por faturamento, com participação, clientes, desconto e devolução por vendedor.
--   2. "Desconto × devolução" — cada ponto é um vendedor (x = desconto % sobre a tabela, y = devolução % do faturado,
--      tamanho = faturamento), com as linhas de referência na média da empresa.
--   3. "Placar dos vendedores" — a tabela com faturamento, participação, clientes, desconto e devolução por vendedor.
--
-- A ajuda "?" é carregada por ROTA (fn_ajuda_campo_listar filtra c.rota = p_rota); por isso as chaves são do v6
-- (prefixo comv6.) com a rota do v6, dando continuidade às chaves da aba Visão geral (bloco 2).
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Não altera RLS, grant, RPC nem dado de cliente.

-- Atualiza a descrição da tela no catálogo para refletir a nova aba (RD-98 p3). A tela já estava registrada pelo
-- bloco 2; aqui só completamos a descrição funcional (views/rpcs são as mesmas: fn_bi_comercial_base + ajuda).
UPDATE public.system_screens
   SET descricao_funcional = 'Painel comercial v6 em storytelling: conta, em texto e gráfico, como a empresa está vendendo. Aba "Visão geral" (faturamento, volume, preço, faturamento por dia, linhas de produto, ritmo da semana) e aba "Vendedores" (quem vende quanto, desconto × devolução por vendedor e o placar dos vendedores). Mesma guarda de escopo do BI (líder vê a empresa; vendedor só o próprio).'
 WHERE id = 'comercial_meu_painel_v6'
   AND descricao_funcional IS DISTINCT FROM 'Painel comercial v6 em storytelling: conta, em texto e gráfico, como a empresa está vendendo. Aba "Visão geral" (faturamento, volume, preço, faturamento por dia, linhas de produto, ritmo da semana) e aba "Vendedores" (quem vende quanto, desconto × devolução por vendedor e o placar dos vendedores). Mesma guarda de escopo do BI (líder vê a empresa; vendedor só o próprio).';

-- Ajuda de campo "?" (RD-95) da aba Vendedores do v6.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.vend_quanto', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Quem vende quanto', 'comercial', 8, 'publicado',
   'Indicador calculado — não se preenche.',
   'Ranking dos vendedores por faturamento no período, com a participação de cada um no total, quantos clientes atendeu, o desconto cedido e a devolução.',
   'Se um vendedor responde por 30% do faturamento, uma queda dele pesa mais que a de três vendedores pequenos.',
   'Olhar só o faturamento: um vendedor que vende muito com desconto alto pode dar menos margem que um menor.'),
  ('comv6.vend_desc_dev', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Desconto × devolução', 'comercial', 9, 'publicado',
   'Gráfico calculado — não se preenche.',
   'Cada ponto é um vendedor: no eixo horizontal o desconto que ele cede (% sobre a tabela) e no vertical a devolução (% do que ele faturou); o tamanho do ponto é o faturamento. As linhas tracejadas marcam a média da empresa.',
   'Um vendedor no canto superior direito cede muito desconto E tem muita devolução — é onde a margem mais escapa.',
   'Ler o eixo sem olhar o tamanho do ponto: um ponto pequeno no canto ruim pesa pouco no total.'),
  ('comv6.vend_placar', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Placar dos vendedores', 'comercial', 10, 'publicado',
   'Indicador calculado — não se preenche.',
   'A tabela com todos os vendedores: faturamento, participação, clientes atendidos, desconto (% sobre a tabela) e devolução (% do faturado). Em vermelho, o que está acima da média da empresa.',
   'Desconto de 2,5% com a média da empresa em 1,8% aparece em vermelho — sinal de política de preço mais agressiva.',
   'Comparar o desconto em R$ entre vendedores de tamanhos diferentes: o % sobre a tabela é o que permite a comparação justa.')
ON CONFLICT (chave) DO NOTHING;
