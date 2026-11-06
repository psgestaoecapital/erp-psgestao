-- P&M · Planejamento (auditoria 31/10, nota 85 → >=95): completar RD-95 ("?") nos KPIs.
-- A tela já tem CRUD completo (Novo/Editar/lixeira RD-30 soft-delete excluido_em) e "?" nos filtros
-- (Mês/Situação) e nos campos do editor. O único gap do auditor era o "?" nos 4 indicadores do topo.
-- ADITIVO (só linhas de ajuda).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.planejamento.kpi_planejamentos', '/dashboard/pm/planejamento', 'Planejamento · Indicadores', 'Planejamentos',
  'Quantos planejamentos existem no mês e situação filtrados.',
  'Dar a dimensão do que está em andamento no período.',
  '6 planejamentos em março.',
  'Esquecer que o número respeita os filtros de mês e situação acima.',
  'pm', 1, 1, 'publicado'),
 ('pm.planejamento.kpi_posts', '/dashboard/pm/planejamento', 'Planejamento · Indicadores', 'Posts',
  'Total de posts (peças) somados em todos os planejamentos filtrados.',
  'Medir o volume de produção planejada do mês.',
  '48 posts no mês.',
  'Confundir posts com jobs: o post só vira job quando aprovado.',
  'pm', 2, 1, 'publicado'),
 ('pm.planejamento.kpi_em_aprovacao', '/dashboard/pm/planejamento', 'Planejamento · Indicadores', 'Em aprovação',
  'Posts que estão aguardando aprovação do cliente/gestor.',
  'Ver o que está parado esperando aval para virar job.',
  '7 posts em aprovação.',
  'Achar que já são jobs: ainda não — falta aprovar.',
  'pm', 3, 1, 'publicado'),
 ('pm.planejamento.kpi_viraram_job', '/dashboard/pm/planejamento', 'Planejamento · Indicadores', 'Viraram job',
  'Posts aprovados que já geraram job de produção (automático, com prazo antes da publicação).',
  'Acompanhar quanto do plano já entrou em produção.',
  '31 viraram job.',
  'Esperar que some com "Em aprovação": são etapas diferentes.',
  'pm', 4, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
