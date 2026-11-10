-- Painel Comercial v6 (storytelling) — bloco 2: completa a aba "Visão geral" com "As linhas de produto" e
-- "Ritmo da semana" na rota NOVA /dashboard/comercial/meu-painel-v6 (o v5 em /meu-painel segue intacto).
--
-- Dois ajustes de infraestrutura que o bloco 1 (#4345) deixou pendentes e que o auditor cobra (RD-95/RD-98 p3):
--   1. A ajuda "?" é carregada por ROTA (fn_ajuda_campo_listar filtra c.rota = p_rota). O bloco 1 reaproveitou as
--      chaves do v5 (rota /dashboard/comercial/meu-painel), então os cartões "?" voltavam VAZIOS no v6. A chave é
--      única no banco (erp_ajuda_campo_chave_key), logo o v6 precisa das PRÓPRIAS chaves (prefixo comv6.) com a rota
--      do v6. Esta migration cadastra as chaves dos indicadores do v6 (os 5 do bloco 1 + os 2 novos deste bloco).
--   2. A rota /meu-painel-v6 não existia em system_screens — a tela não era auditável nem documentava a origem do
--      dado (RD-98 p3). Esta migration a registra com views_consumidas/rpcs_chamadas.
--
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Não altera RLS, grant, RPC nem dado de cliente.

-- 1) Tela auditável + origem do dado (RD-98 p3)
INSERT INTO public.system_screens
  (id, area, rota, modulo, titulo, estado_real, descricao_funcional,
   componentes_principais, views_consumidas, rpcs_chamadas, prioridade_monitoramento, auditavel_robo)
VALUES
  ('comercial_meu_painel_v6', 'industria', '/dashboard/comercial/meu-painel-v6', 'comercial_meu_painel_v6',
   'Meu painel de vendas (v6 storytelling)', 'parcial',
   'Painel comercial v6 em storytelling: conta, em texto e gráfico, como a empresa está vendendo. A aba Visão geral traz faturamento, volume e preço do período, faturamento por dia, as linhas de produto e o ritmo da semana. Mesma guarda de escopo do BI (líder vê a empresa; vendedor só o próprio).',
   ARRAY['MeuPainelV6']::text[],
   ARRAY['bi_comercial_venda_item_mv']::text[],
   ARRAY['fn_bi_comercial_base','fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[],
   'media', true)
ON CONFLICT (id) DO UPDATE
  SET views_consumidas = EXCLUDED.views_consumidas,
      rpcs_chamadas    = EXCLUDED.rpcs_chamadas,
      descricao_funcional = EXCLUDED.descricao_funcional;

-- 2) Ajuda de campo "?" (RD-95) da aba Visão geral do v6
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.faturado', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Faturamento', 'comercial', 1, 'publicado',
   'Indicador calculado — não se preenche.',
   'Soma do valor líquido vendido no período (todas as linhas, inclusive despojo e subprodutos).',
   'No período de aceite da Frioeste (01/10–06/11): R$ 13.983.740.',
   'Comparar com um mês cheio quando o período mostrado tem menos dias — confira sempre as datas no topo.'),
  ('comv6.volume', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Volume na análise', 'comercial', 2, 'publicado',
   'Indicador calculado — não se preenche.',
   'Peso (em toneladas) somente dos produtos que entram na análise de preço (carne e miúdo), base do R$/kg.',
   'A carne s/osso resfriada sozinha pesou ~192 t no período de aceite.',
   'Esperar que bata com o volume total: o despojo e os subprodutos ficam de fora da análise de preço.'),
  ('comv6.preco', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Preço médio', 'comercial', 3, 'publicado',
   'Indicador calculado — não se preenche.',
   'R$ por kg da análise: soma do valor ÷ soma do peso dos produtos de carne/miúdo (sem o despojo, que distorce o preço).',
   'No aceite da Frioeste o preço da análise fica em R$ 30,61/kg.',
   'Dividir o faturamento total pelo peso total — o despojo é barato e por kg e derrubaria o preço médio.'),
  ('comv6.ticket', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Ticket por nota', 'comercial', 4, 'publicado',
   'Indicador calculado — não se preenche.',
   'Faturamento do período ÷ número de notas fiscais — o valor médio de cada venda.',
   'R$ 14 milhões em 1.000 notas = ticket de R$ 14 mil por nota.',
   'Confundir com ticket por cliente: um cliente pode ter várias notas no período.'),
  ('comv6.fat_dia', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Faturamento por dia', 'comercial', 5, 'publicado',
   'Gráfico calculado — não se preenche.',
   'Mostra o faturamento de cada dia do período, para enxergar picos, quedas e dias sem venda.',
   'Uma barra baixa num dia útil costuma ser feriado ou falha de faturamento.',
   'Ler barra por barra sem olhar o total: um dia forte não compensa uma semana fraca.'),
  ('comv6.linhas', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'As linhas de produto', 'comercial', 6, 'publicado',
   'Indicador calculado — não se preenche.',
   'De onde vem o faturamento: cada linha de produto com seu valor, peso, participação no total e o R$/kg (quando é carne/miúdo).',
   'Na Frioeste a carne s/osso resfriada responde por cerca de metade do faturamento (R$ 6,96 mi, R$ 36,26/kg).',
   'Olhar só o faturamento e ignorar o R$/kg: uma linha pesada e barata fatura muito com margem baixa.'),
  ('comv6.ritmo', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Ritmo da semana', 'comercial', 7, 'publicado',
   'Indicador calculado — não se preenche.',
   'Faturamento somado por dia da semana no período — mostra em que dias a empresa mais vende.',
   'Na Frioeste a sexta-feira é o dia mais forte (R$ 4,0 mi no aceite) e o sábado o mais fraco.',
   'Comparar dias com quantidades diferentes de ocorrências no período sem notar que um teve mais semanas que o outro.')
ON CONFLICT (chave) DO NOTHING;
