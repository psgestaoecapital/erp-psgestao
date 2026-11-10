-- Painel Comercial v6 (storytelling) — bloco 8: aba "Logística" na rota /dashboard/comercial/meu-painel-v6.
-- Cadastra as chaves de ajuda "?" (RD-95) da aba. Aditiva e idempotente (ON CONFLICT DO NOTHING).
-- Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.aba_logistica', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Logística', 'comercial', 60, 'publicado',
   'Navegação — não se preenche.',
   'Mostra a saída: peso das cargas, cargas por dia da semana e as transportadoras que levam o produto.',
   'Abra para dimensionar frota, expedição e custo de transporte.',
   'Esperar dado de logística quando as notas do período não trazem carga/transportador.'),
  ('comv6.log_peso', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Peso das cargas', 'comercial', 61, 'publicado',
   'Indicador calculado — não se preenche.',
   'Quantas cargas saíram, o peso médio e a distribuição por faixa de peso — mostra se a empresa manda muitas cargas pequenas ou poucas grandes.',
   'Muitas cargas pequenas encarecem o frete por kg; consolidar ajuda.',
   'Confundir carga com nota: uma carga pode levar várias notas.'),
  ('comv6.log_dia_semana', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Cargas por dia da semana', 'comercial', 62, 'publicado',
   'Indicador calculado — não se preenche.',
   'Em que dias da semana saem mais cargas — base para dimensionar frota e equipe de expedição.',
   'Pico de cargas na sexta pede mais motoristas nesse dia.',
   'Olhar o total sem o dia: a média esconde o pico que trava a expedição.'),
  ('comv6.log_transportadoras', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Transportadoras', 'comercial', 63, 'publicado',
   'Indicador calculado — não se preenche.',
   'Ranking das transportadoras por peso transportado e faturamento, com a participação de cada uma.',
   'A frota própria costuma liderar; terceiros concentrados em uma transportadora são risco de dependência.',
   'Avaliar transportadora só pelo faturamento: o peso e a área de entrega também pesam no custo.')
ON CONFLICT (chave) DO NOTHING;
