-- Hub §317 (blueprint essencial "três avanços lado a lado"): chave de ajuda RD-95 do novo
-- indicador "Avanço por custo" (executado ponderado pelo custo previsto da tarefa).
-- Aditiva e idempotente: só insere/atualiza a linha de ajuda; não toca estrutura nem dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.cronograma.ind_avanco_custo',
  '/dashboard/projetos/obras/[id]/cronograma',
  'Cronograma da obra',
  'Avanço por custo',
  'Nada a preencher: o sistema calcula.',
  'Média do avanço de cada tarefa ponderada pelo custo previsto dela (não pela duração). Mostra quanto do custo planejado da obra já virou execução física.',
  '30% por custo com 60% por prazo: muitas tarefas baratas prontas, mas as caras ainda por fazer.',
  'Confundir com o avanço financeiro (dinheiro já pago): aqui é avanço físico ponderado pelo custo previsto, não o realizado.',
  'hub_construcao',
  22,
  1,
  'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  vertical        = EXCLUDED.vertical,
  ordem           = EXCLUDED.ordem,
  status          = EXCLUDED.status;
