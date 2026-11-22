-- Hub · Onda C-2 · tela 315 (orçamento por EAP) — metadados da tela de LEITURA (slice 1).
-- Registra a rota nova no system_screens (origem do dado RD-98 p3) e publica os textos de ajuda RD-95 "?"
-- da tela e do atalho no cockpit. Aditivo e idempotente (ON CONFLICT). Não cria/altera estrutura de dados.
-- Code: desenvolvedor_4_g

-- 1) system_screens: a tela existe e o usuário a enxerga; só consome a RPC de leitura da árvore.
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, rpcs_chamadas, auditavel_robo, prioridade_monitoramento)
VALUES (
  gen_random_uuid(),
  '/dashboard/projetos/obras/[id]/orcamento',
  'hub_construcao',
  'projetos_obras',
  'Orçamento por EAP',
  'Árvore da EAP do orçamento da obra (serviço × local) com material, mão de obra, total e % por nó, mais o toggle Etapa/Local. Leitura.',
  'parcial',
  ARRAY['fn_projetos_orcamento_eap_arvore'],
  true,
  'media'
)
ON CONFLICT (rota) DO UPDATE SET
  rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  modulo        = EXCLUDED.modulo,
  area          = EXCLUDED.area,
  titulo        = EXCLUDED.titulo,
  atualizado_em = now();

-- 2) Ajuda de campo (RD-95): indicadores e filtro da tela 315 + atalho no cockpit.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.orcamento_eap.total','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Total do orçamento','A soma de todos os itens do orçamento (material + mão de obra).','Mostra o valor cheio previsto para a obra; é a base para medição, custo e margem.','R$ 1.250.000,00','Confundir o total previsto do orçamento com o custo já realizado (que fica nos Custos da obra).','projetos',10,'publicado'),
 ('projetos.orcamento_eap.material','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Material','A parte do orçamento referente a insumos/materiais, somada de todos os itens.','Separa material de mão de obra para você ver a composição do custo e negociar compra.','R$ 700.000,00','Lançar mão de obra no custo de material — cada item separa os dois.','projetos',20,'publicado'),
 ('projetos.orcamento_eap.mao_obra','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Mão de obra','A parte do orçamento referente à mão de obra, somada de todos os itens.','Separa a mão de obra do material para medição e para comparar com o apropriado.','R$ 550.000,00','Somar mão de obra por hora aqui — este é o custo orçado do serviço, não o ponto.','projetos',30,'publicado'),
 ('projetos.orcamento_eap.agrupar','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Agrupar por','Escolha ver o orçamento pela árvore da EAP (etapas) ou pivotado por local da obra.','A mesma soma vista de dois ângulos: por etapa de serviço ou por onde o serviço acontece.','Etapa (EAP) para fechar o orçamento; Local para checar o custo de um pavimento.','Achar que o total muda ao trocar o agrupamento — é a mesma soma reorganizada.','projetos',40,'publicado'),
 ('projetos.cockpit.orcamento','/dashboard/projetos/obras/[id]/cockpit','Cockpit da obra','Orçamento (EAP)','Atalho para o orçamento da obra estruturado pela EAP.','Abre a árvore da EAP com material, mão de obra e total por etapa/local.','Clique para revisar o orçamento previsto da obra.','—','projetos',95,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  status          = 'publicado',
  atualizado_em   = now();
