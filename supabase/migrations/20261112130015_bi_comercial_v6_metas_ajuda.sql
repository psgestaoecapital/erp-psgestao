-- Painel Comercial v6 (storytelling) — bloco 9 (final): aba "Metas" na rota /dashboard/comercial/meu-painel-v6.
-- Cadastra as chaves de ajuda "?" (RD-95) da aba. Aditiva e idempotente (ON CONFLICT DO NOTHING).
-- Não altera RLS, grant, RPC nem dado de cliente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, vertical, ordem, status, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('comv6.aba_metas', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Aba Metas', 'comercial', 70, 'publicado',
   'Navegação — não se preenche.',
   'Mostra a projeção do mês pelo ritmo atual e, quando houver meta oficial cadastrada, o realizado × meta.',
   'Abra para acompanhar se o mês caminha para o resultado esperado.',
   'Tratar a projeção como meta: projeção é estimativa pelo ritmo, meta é o alvo definido pelo gestor.'),
  ('comv6.meta_projecao', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Projeção do mês', 'comercial', 71, 'publicado',
   'Indicador calculado — não se preenche.',
   'Faturamento já realizado no mês corrente e a projeção linear de fechamento (realizado ÷ dias decorridos × dias do mês).',
   'Realizado R$ 7 mi no dia 15 de um mês de 30 dias projeta ~R$ 14 mi.',
   'Esperar precisão da projeção no começo do mês, quando poucos dias ainda distorcem a estimativa.'),
  ('comv6.meta_oficial', '/dashboard/comercial/meu-painel-v6', 'Meu painel v6', 'Meta oficial', 'comercial', 72, 'publicado',
   'Indicador — a meta oficial é cadastrada pelo gestor (por empresa ou vendedor); aqui só se exibe.',
   'Quando houver meta cadastrada, compara o realizado com a meta e mostra o quanto falta.',
   'Uma referência comum é o faturamento do mês anterior mais o crescimento desejado.',
   'Definir meta sem olhar o realizado recente: o mês anterior é um bom piso de partida.')
ON CONFLICT (chave) DO NOTHING;
