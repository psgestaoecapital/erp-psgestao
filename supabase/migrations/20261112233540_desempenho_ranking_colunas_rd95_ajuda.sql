-- RD-95 (CEO 08/10): "?" por COLUNA na tabela de Ranking de Vendedores da tela
-- /dashboard/projetos/desempenho (Desempenho Comercial · Hub). Gap apontado pelo aud8 (11/11):
-- os indicadores (KPIs) e os blocos (Funil/Ranking/Perdas) já têm "?", mas as COLUNAS da tabela de
-- vendedores não tinham ajuda própria. As colunas Conversão, Ticket e Comissão reusam as chaves já
-- existentes dos KPIs (mesmo significado); as demais ganham chave própria aqui.
-- Aditiva e idempotente: só INSERE chaves novas, nenhuma linha existente é tocada (ON CONFLICT DO NOTHING).
-- Área Hub (projetos), não é núcleo. RD-100: nenhum nome de sistema de terceiros.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.desempenho.col_vendedor', '/dashboard/projetos/desempenho', 'Ranking', 'projetos',
   'Vendedor',
   'O responsável pela oportunidade — quem está tocando o negócio no funil comercial.',
   'Organiza o ranking por pessoa, para comparar o desempenho de cada vendedor no período.',
   'Ana Souza, Carlos Lima, Equipe interna.',
   'Oportunidade sem responsável aparece agrupada à parte; defina o responsável no cadastro da oportunidade para ela entrar no ranking certo.',
   120),
  ('projetos.desempenho.col_oportunidades', '/dashboard/projetos/desempenho', 'Ranking', 'projetos',
   'Oportunidades',
   'Quantas oportunidades do vendedor estiveram ativas no período (abertas, ganhas ou perdidas).',
   'É a base do funil de cada vendedor: quanto entrou para ele trabalhar no período.',
   '12 oportunidades no mês.',
   'Confundir com propostas — nem toda oportunidade chega a virar proposta enviada.',
   130),
  ('projetos.desempenho.col_propostas', '/dashboard/projetos/desempenho', 'Ranking', 'projetos',
   'Propostas',
   'Quantas das oportunidades do vendedor avançaram a ponto de ter uma proposta enviada ao cliente.',
   'Mostra quanto do funil de cada vendedor amadureceu de interesse para oferta formal.',
   'De 12 oportunidades, 7 viraram proposta.',
   'Esperar que propostas seja igual a ganhas — proposta enviada ainda pode ser recusada.',
   140),
  ('projetos.desempenho.col_ganhas', '/dashboard/projetos/desempenho', 'Ranking', 'projetos',
   'Ganhas',
   'Quantas oportunidades o vendedor fechou como venda no período.',
   'É o resultado do funil: quantas oportunidades viraram negócio de fato.',
   '3 ganhas no mês.',
   'Contar oportunidade que voltou a ser reaberta como ganha; só conta quando o status está em ganho.',
   150),
  ('projetos.desempenho.col_valor_ganho', '/dashboard/projetos/desempenho', 'Ranking', 'projetos',
   'Valor ganho',
   'A soma do valor das oportunidades que o vendedor fechou no período.',
   'Mede o quanto cada vendedor trouxe em receita fechada, não só a quantidade de vendas.',
   '3 ganhas somando R$ 84.500,00.',
   'Comparar só o valor sem olhar a quantidade: uma venda grande pode esconder um mês de poucos fechamentos.',
   160)
ON CONFLICT (chave) DO NOTHING;
