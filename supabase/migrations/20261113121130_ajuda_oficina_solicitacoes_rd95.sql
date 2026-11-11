-- Oficina · Solicitações de peça (/dashboard/oficina/solicitacoes) — RD-95 "?" dos filtros.
-- Code: rodrigo-code. A tela não tinha nenhum "?": os dois filtros (por OS e por status) ganham ajuda de campo.
-- Aditiva e idempotente (catálogo global de ajuda, sem company_id, sem RLS por empresa, sem dado de cliente).
-- Prova RD-38:
--   antes: SELECT count(*) FROM public.erp_ajuda_campo
--          WHERE chave IN ('oficina.solicitacoes.filtro_os','oficina.solicitacoes.filtro_status');  => 0
--   depois: => 2  (só inserções novas; ON CONFLICT (chave) DO NOTHING — nada é apagado nem alterado).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('oficina.solicitacoes.filtro_os', '/dashboard/oficina/solicitacoes', 'Solicitações de peça', 'oficina',
   'Filtrar por OS',
   'Escolha uma ordem de serviço para ver só as peças pedidas naquele veículo. "Todas as OS" mostra os pedidos de todas as ordens abertas.',
   'Ajuda a focar numa OS quando há muitos pedidos ao mesmo tempo — por exemplo, para aprovar de uma vez todas as peças de um carro.',
   'Selecionar "OS 1042 · ABC1D23" para decidir só as peças daquele carro.',
   'Achar que não há pedidos: confira se não está preso numa OS específica — volte para "Todas as OS".',
   1),
  ('oficina.solicitacoes.filtro_status', '/dashboard/oficina/solicitacoes', 'Solicitações de peça', 'oficina',
   'Filtrar por status',
   'Escolha o estágio do pedido: Pendentes (aguardando sua decisão), Aprovados, Comprados, Trocados ou Recusados. "Todos" mostra tudo.',
   'Separa o que precisa de ação (Pendentes) do que já foi resolvido (histórico), para você decidir rápido o que está parado.',
   'Deixar em "Pendentes" no dia a dia para ver só o que falta aprovar ou comprar.',
   'Esquecer o filtro em "Recusados" e achar que não chega pedido novo: volte para "Pendentes" ou "Todos".',
   2)
ON CONFLICT (chave) DO NOTHING;
