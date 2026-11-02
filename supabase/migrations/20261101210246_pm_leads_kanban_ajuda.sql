-- /dashboard/pm/leads (Leads / Funil): ajuda "?" do quadro Kanban — colunas (etapas) e ações do card (RD-95).
-- ADITIVA e idempotente. Só insere 2 linhas de ajuda; nada de núcleo. As colunas do Kanban são as etapas
-- configuráveis do funil (funil_etapa), por isso o "?" fica no cabeçalho do quadro (uma explicação), e não
-- repetido em cada card/botão (RD-99: poucos cliques, sem poluição visual).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('pm.leads.kanban_colunas', '/dashboard/pm/leads', 'Leads (Funil)', 'Colunas do quadro',
   'Cada coluna é uma etapa do funil de vendas. Arraste o card do lead para a coluna que representa onde ele está hoje. As etapas são configuráveis em "Configurar funil".',
   'Ver, de relance, quantos leads e quanto valor há em cada etapa e mover o lead conforme ele avança (ou é perdido).',
   'Um lead que acabou de responder ao primeiro contato → arraste para a coluna "Qualificação".',
   'Tratar as colunas como fixas: elas vêm do SEU funil (funil_etapa) e podem ser renomeadas, reordenadas ou criadas em Configurar funil.',
   'pm', 5, 1, 'publicado'),
  ('pm.leads.kanban_acoes', '/dashboard/pm/leads', 'Leads (Funil)', 'Ações do card',
   'No rodapé de cada card: Tarefas (agendar reunião/retorno), Proposta (abre/cria a proposta ligada), Ver/Solicitar contrato, Editar, e em "⋯" o fechamento (Ganhar, Perder, Converter em cliente da GE, Excluir).',
   'Tocar o lead sem sair do quadro: avançar a negociação, abrir proposta, fechar como ganho/perdido e manter o histórico.',
   'Negócio fechado → "⋯" → Ganhar; depois "Solicitar contrato" no card do fechamento.',
   'Excluir não apaga de vez: é exclusão rastreável (soft-delete), o lead pode ser recuperado. "Converter" liga o lead a um cliente do cadastro (GE).',
   'pm', 6, 1, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM erp_ajuda_campo e WHERE e.chave = v.chave);
