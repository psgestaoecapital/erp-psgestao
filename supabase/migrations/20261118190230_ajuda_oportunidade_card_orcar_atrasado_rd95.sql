-- #9474 · RD-95: "?" do novo indicador "Orçamento em atraso" no card do Kanban de Oportunidades.
-- O card em "Orçando" ganha um selo vermelho quando passa do prazo de elaboração (5 dias).
-- Aditivo e idempotente: só insere/atualiza a linha de ajuda (catálogo global erp_ajuda_campo).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'projetos.oportunidades.card_orcar_atrasado',
  '/dashboard/projetos/oportunidades',
  'Kanban',
  'Orçamento em atraso',
  'Nada a preencher: o selo vermelho acende sozinho quando a oportunidade fica mais de 5 dias na coluna "Orçando" sem o orçamento sair.',
  'Marca a fila de orçamentos que estourou o prazo de elaboração (5 dias), para o time priorizar quem está esperando há mais tempo.',
  'Entrou em "Orçando" dia 16/11 — a partir de 21/11 o card fica com o selo vermelho "em atraso".',
  'Deixar o card com o selo vermelho parado: é um cliente aguardando o orçamento além do prazo combinado.',
  'hub_construcao',
  72,
  'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  grupo = EXCLUDED.grupo,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = EXCLUDED.status,
  atualizado_em = now();
