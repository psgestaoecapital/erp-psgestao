-- Quadro de chamados · Fase 2 do #7050 (CEO 09/11): textos de ajuda ("?", RD-95) da busca, do filtro e do quadro.
-- Aditiva e idempotente: só INSERT ... ON CONFLICT DO NOTHING em erp_ajuda_campo. Sem tabela nova, sem função, sem RLS nova.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('melhorias.kanban.busca', '/dashboard/melhorias', 'Quadro de chamados', 'Busca',
  'Digite o número do chamado (com ou sem #), parte do título, da descrição, o nome da empresa, quem abriu ou o status.',
  'Acha qualquer chamado rápido, inclusive os finalizados e os arquivados (que não aparecem no quadro).',
  '7050  ·  #7050  ·  "impressão"  ·  Frioeste',
  'Procurar pela data: a busca não entende datas, use o número ou um trecho do texto.',
  'chamados', 10, 'publicado'),
 ('melhorias.kanban.filtro', '/dashboard/melhorias', 'Quadro de chamados', 'Gerais / Minha carteira',
  'Escolha Gerais para ver todos os chamados da empresa, ou Minha carteira para ver só os que estão com você.',
  'Separa o que é seu do que é da equipe, sem perder o quadro.',
  'Minha carteira',
  'Achar que Minha carteira mostra só os seus chamados abertos: ela mostra os que têm você como responsável.',
  'chamados', 20, 'publicado')
ON CONFLICT (chave) DO NOTHING;
