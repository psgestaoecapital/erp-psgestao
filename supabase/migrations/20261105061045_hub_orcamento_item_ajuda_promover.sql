-- ONDA 1 (HUB) · Item de composição unificado — slice 4 (UI "Promover a produto").
-- Aditiva e idempotente: cadastra a chave de ajuda (RD-95 "?") da nova ação
-- "Cadastrar no catálogo" na tela /dashboard/hub/orcamento-itens.
-- Só dado de referência global (erp_ajuda_campo); não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT
  'hub.orcamento_itens.acao_promover',
  '/dashboard/hub/orcamento-itens',
  'Itens do orçamento · Ações',
  'Cadastrar no catálogo',
  'Ação (não é campo): transforma um item digitado à mão (manual, sem produto vinculado) em um produto do catálogo e já o vincula a este item.',
  'Para um item manual que você usa com frequência: ao cadastrá-lo no catálogo, ele vira produto, ganha código próprio e fica disponível para escolher nos próximos orçamentos (sem redigitar). O item deste orçamento passa a ser de catálogo.',
  'Um item manual "Locação de andaime" que se repete em vários orçamentos: cadastre no catálogo e, no próximo orçamento, busque-o pelo nome.',
  'Tentar cadastrar um item que já veio do catálogo (já tem produto vinculado) ou um item sem descrição: a ação só vale para item manual com nome preenchido, e o botão aparece só nesses casos.',
  'hub',
  32
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'hub.orcamento_itens.acao_promover'
);
