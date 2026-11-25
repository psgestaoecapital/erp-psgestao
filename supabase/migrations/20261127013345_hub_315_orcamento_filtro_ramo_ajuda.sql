-- Hub §315 MODOS (RD-95): chave de ajuda do filtro "Só o meu ramo / Todas as etapas" do Orçamento por EAP
-- (/dashboard/projetos/obras/[id]/orcamento). O filtro aparece só para a empresa no modo prestadora com ramo.
-- Aditiva e idempotente: só insere/atualiza a linha de ajuda; não toca estrutura nem dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.orcamento_eap.filtro_ramo',
  '/dashboard/projetos/obras/[id]/orcamento',
  'Orçamento por EAP',
  'Só o meu ramo / Todas as etapas',
  'Escolha "Só o meu ramo" para ver apenas as etapas do serviço que a sua empresa presta, ou "Todas as etapas" para ver o orçamento inteiro da obra.',
  'Quem presta um serviço (pisos, elétrica, pintura…) enxerga direto o que é dele, sem procurar no meio das outras etapas da obra. Os valores não mudam: é só o que aparece na tela.',
  'Empresa de pisos e revestimentos: "Só o meu ramo" mostra as etapas 14 e 15 e os itens delas.',
  'Achar que um item sumiu do orçamento: ele continua lá — toque em "Todas as etapas" para vê-lo. O ramo da empresa é escolhido no perfil do Hub.',
  'projetos',
  185,
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
