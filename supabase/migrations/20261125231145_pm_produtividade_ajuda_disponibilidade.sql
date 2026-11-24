-- P&M · tela 121 "Planejamento de recursos e capacidade" · fatia 3 (disponibilidade)
-- RD-95: cadastra a chave de ajuda do novo indicador "Disponibilidade" da tela /dashboard/pm/produtividade.
-- Aditiva e idempotente; só insere linha em erp_ajuda_campo (WHERE NOT EXISTS). Não toca tabela/RLS/dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('pm.produtividade.disponibilidade', '/dashboard/pm/produtividade', 'Utilização da equipe · Indicadores',
   'Disponibilidade',
   'Indicador calculado: capacidade do período menos as horas já apontadas (nunca negativo).',
   'Mostra quantas horas a equipe ainda tem livres — quem tem folga para pegar trabalho novo.',
   'Capacidade de 600 h com 420 h apontadas ⇒ 180 h de disponibilidade no período.',
   'Confundir com o estouro de capacidade: horas acima de 100% aparecem em vermelho no heatmap; a disponibilidade só conta a folga, por isso nunca fica negativa.',
   'pm', 65, 'publicado'),
  ('pm.produtividade.ordenar', '/dashboard/pm/produtividade', 'Utilização da equipe · Filtro',
   'Ordenar a equipe',
   'Escolha como listar as pessoas no painel: por Nome (A–Z) ou por Mais disponível (maior folga primeiro).',
   'Achar rápido quem tem capacidade livre para receber um job novo sem estourar a semana.',
   'Em "Mais disponível", quem tem 180 h livres aparece acima de quem tem 20 h.',
   'Esperar que mude as horas: só reordena a lista; os números de cada pessoa continuam os mesmos.',
   'pm', 66, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
